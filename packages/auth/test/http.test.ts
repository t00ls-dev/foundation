import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFoundationAuth, type FoundationAuth } from "../src/index.js";

describe("foundation auth HTTP flows", () => {
  const sent: Array<{ subject: string; text: string; to: string }> = [];
  let auth: FoundationAuth;
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    sent.splice(0);
    auth = createFoundationAuth({
      baseURL: "http://localhost:3000",
      database: memoryAdapter({
        account: [],
        session: [],
        user: [],
        verification: [],
      }),
      email: {
        send(input) {
          sent.push(input);
          return Promise.resolve();
        },
      },
      secret: "test-secret-with-at-least-thirty-two-characters",
    });
  });

  it("registers and sends email verification without exposing credentials", async () => {
    const response = await post("/api/auth/sign-up/email", {
      email: "person@example.com",
      name: "Person",
      password: "correct-horse-battery-staple",
    });
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("person@example.com");
    expect(sent[0]?.subject).toBe("Verify your email");
  });

  it("does not enable TOTP or expose plugin server APIs without an opt-in", async () => {
    expect(
      (await post("/api/auth/two-factor/enable", { password: "unused" }))
        .status,
    ).toBe(404);
    expect(Object.keys(auth).sort()).toEqual(["handler", "resolveSession"]);
  });

  it("requires a second explicit opt-in before exposing enrollment", async () => {
    auth = createFoundationAuth({
      baseURL: "http://localhost:3000",
      database: memoryAdapter({
        account: [],
        session: [],
        user: [],
        verification: [],
        twoFactor: [],
      }),
      email: { send: () => Promise.resolve() },
      secret: "test-secret-with-at-least-thirty-two-characters",
      totp: { issuer: "Links" },
    });
    expect(
      (await post("/api/auth/two-factor/enable", { password: "unused" }))
        .status,
    ).toBe(404);
    expect(Object.keys(auth).sort()).toEqual(["handler", "resolveSession"]);
  });

  it("accepts magic-link and password-reset requests without user enumeration", async () => {
    await post("/api/auth/sign-up/email", {
      email: "person@example.com",
      name: "Person",
      password: "correct-horse-battery-staple",
    });
    sent.splice(0);
    const magic = await post("/api/auth/sign-in/magic-link", {
      callbackURL: "/",
      email: "person@example.com",
    });
    const reset = await post("/api/auth/request-password-reset", {
      email: "person@example.com",
      redirectTo: "/reset-password",
    });
    expect(magic.status).toBe(200);
    expect(reset.status).toBe(200);
    expect(sent.map((email) => email.subject)).toEqual([
      "Sign in",
      "Reset your password",
    ]);
  });

  it("requires verification and resolves and revokes a persistent session", async () => {
    const credentials = {
      email: "person@example.com",
      password: "correct-horse-battery-staple",
    };
    await post("/api/auth/sign-up/email", { ...credentials, name: "Person" });
    expect((await post("/api/auth/sign-in/email", credentials)).status).toBe(
      403,
    );
    const verification = sent.find(
      (message) => message.subject === "Verify your email",
    );
    expect(verification).toBeDefined();
    const verified = await auth.handler(new Request(verification!.text));
    expect([200, 302]).toContain(verified.status);
    const login = await post("/api/auth/sign-in/email", credentials);
    expect(login.ok).toBe(true);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");
    const headers = new Headers({ Cookie: cookie });
    const resolved = await auth.resolveSession(headers);
    expect(resolved.data?.user.email).toBe(credentials.email);
    expect(resolved.data?.session.expiresAt).toBeInstanceOf(Date);
    expect(resolved.headers).toBeInstanceOf(Headers);
    expect(await auth.resolveSession(new Headers())).toMatchObject({
      data: null,
    });
    expect(
      await auth.resolveSession(
        new Headers({ Cookie: "better-auth.session_token=invalid" }),
      ),
    ).toMatchObject({ data: null });
    const logout = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-out", {
        method: "POST",
        headers: {
          "Cookie": cookie,
          "Origin": "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(logout.ok).toBe(true);
    expect((await auth.resolveSession(headers)).data).toBeNull();
    expect(Object.keys(auth).sort()).toEqual(["handler", "resolveSession"]);
  });

  it("rejects Google OAuth state as a Magic Link without issuing a session", async () => {
    auth = createFoundationAuth({
      baseURL: "http://localhost:3000",
      database: memoryAdapter({
        account: [],
        session: [],
        user: [],
        verification: [],
      }),
      email: {
        send(input) {
          sent.push(input);
          return Promise.resolve();
        },
      },
      google: {
        clientId: "test-google-client",
        clientSecret: "test-google-secret",
      },
      secret: "test-secret-with-at-least-thirty-two-characters",
    });
    const email = "person@example.com";
    const start = await post("/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "/",
      additionalData: { email },
    });
    expect(start.status).toBe(200);
    const authorization = (await start.json()) as { url: string };
    const url = new URL(authorization.url);
    expect(url.origin).toBe("https://accounts.google.com");
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();

    const forged = await auth.handler(
      new Request(
        `http://localhost:3000/api/auth/magic-link/verify?token=${encodeURIComponent(state!)}&callbackURL=/`,
      ),
    );
    expect(forged.status).toBe(302);
    expect(
      new URL(forged.headers.get("location")!).searchParams.get("error"),
    ).toBe("INVALID_TOKEN");
    expect(forged.headers.getSetCookie().join(";")).not.toContain(
      "session_token",
    );
    expect(sent).toHaveLength(0);
    expect((await auth.resolveSession(new Headers())).data).toBeNull();

    // A newly issued email link still authenticates with Google enabled.
    expect(
      (await post("/api/auth/sign-in/magic-link", { email, callbackURL: "/" }))
        .status,
    ).toBe(200);
    expect(sent).toHaveLength(1);
    const verified = await auth.handler(new Request(sent[0]!.text));
    expect(verified.status).toBe(302);
    const cookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");
    expect(
      (await auth.resolveSession(new Headers({ Cookie: cookie }))).data?.user
        .email,
    ).toBe(email);
    const replay = await auth.handler(new Request(sent[0]!.text));
    expect(
      new URL(replay.headers.get("location")!).searchParams.get("error"),
    ).toBe("INVALID_TOKEN");
    expect(replay.headers.getSetCookie().join(";")).not.toContain(
      "session_token",
    );
  });

  it("does not log authentication links or tokens from provider failures", async () => {
    let link = "";
    const captured = [
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "log"),
    ];
    for (const capture of captured) capture.mockImplementation(() => undefined);
    auth = createFoundationAuth({
      baseURL: "http://localhost:3000",
      database: memoryAdapter({
        account: [],
        session: [],
        user: [],
        verification: [],
      }),
      email: {
        send(input) {
          link = input.text;
          throw new Error(`Email delivery failed: ${input.text}`);
        },
      },
      secret: "test-secret-with-at-least-thirty-two-characters",
    });
    const response = await post("/api/auth/sign-in/magic-link", {
      email: "person@example.com",
      callbackURL: "/",
    });
    expect(response.status).toBe(500);
    expect(link).toContain("token=");
    const logs = captured.flatMap((capture) => capture.mock.calls);
    expect(logs.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(logs);
    expect(serialized).toContain("auth.endpoint_failed");
    expect(serialized).not.toContain(link);
    expect(serialized).not.toContain(new URL(link).searchParams.get("token"));
    expect(serialized).not.toContain("person@example.com");
  });

  it("sanitizes unexpected adapter failures instead of using router fallback logs", async () => {
    const secret = "sensitive-token-in-unexpected-query-error";
    const captured = [
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "log"),
    ];
    for (const capture of captured) capture.mockImplementation(() => undefined);
    auth = createFoundationAuth({
      baseURL: "http://localhost:3000",
      database: () => {
        throw new Error(
          `SQL params: ${secret}; https://example.com/auth?token=${secret}`,
        );
      },
      email: { send: () => Promise.resolve() },
      secret: "test-secret-with-at-least-thirty-two-characters",
    });
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session"),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "AUTH_FAILURE",
      message: "Authentication request failed. Please try again.",
    });
    const logs = JSON.stringify(
      captured.flatMap((capture) => capture.mock.calls),
    );
    expect(logs).toContain("auth.endpoint_failed");
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain("SQL params");
    expect(logs).not.toContain("https://example.com/auth");
  });

  function post(path: string, body: Readonly<Record<string, unknown>>) {
    return auth.handler(
      new Request(`http://localhost:3000${path}`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://localhost:3000",
        },
        method: "POST",
      }),
    );
  }
});
