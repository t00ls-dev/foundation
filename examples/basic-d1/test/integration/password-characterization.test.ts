import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/server/app.js";
import type { Env } from "../../src/server/auth.js";
import { applyMigrations, createTestDatabase, faultD1Queries } from "../d1.js";

const sessionSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
  }),
  session: z.object({ id: z.string(), token: z.string() }),
});
const accountsSchema = z.array(
  z.object({
    providerId: z.string(),
    accountId: z.string(),
    userId: z.string(),
  }),
);

describe("security characterization: Better Auth password and sessions on real D1", () => {
  const origin = "http://localhost:3000";
  const email = "password-characterization@example.com";
  const oldPassword = "existing-password-for-characterization";
  const newPassword = "replacement-password-for-characterization";
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let env: Env;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    database = await createTestDatabase();
    await applyMigrations(database.binding);
    sent.splice(0);
    env = {
      DB: database.binding,
      BASE_URL: origin,
      AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
      EMAIL_FROM: "test@example.com",
      RESEND_API_KEY: "not-used",
      ASSETS: { fetch: () => Promise.resolve(new Response("SPA")) },
    };
    app = createApp(() => ({
      send(input) {
        sent.push(input);
        return Promise.resolve();
      },
    }));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await database.miniflare.dispose();
  });

  function request(path: string, method = "GET", cookie = "", body?: unknown) {
    return app.request(
      `${origin}${path}`,
      {
        method,
        headers: {
          "Origin": origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  }
  function hasSessionCookie(response: Response) {
    return response.headers
      .getSetCookie()
      .some(
        (value) =>
          value.startsWith("better-auth.session_token=") &&
          !value.includes("Max-Age=0"),
      );
  }
  function sessionCookie(response: Response) {
    expect(hasSessionCookie(response)).toBe(true);
    return response.headers
      .getSetCookie()
      .filter((value) => value.startsWith("better-auth.session_token="))
      .map((value) => value.split(";")[0])
      .join("; ");
  }
  function delivered(subject: string) {
    const message = sent.findLast(
      (value) => value.to === email && value.subject === subject,
    );
    if (!message) throw new Error("Expected a captured authentication email");
    return message.text;
  }
  async function login(password: string) {
    return request("/api/auth/sign-in/email", "POST", "", { email, password });
  }
  async function identity(cookie: string) {
    const response = await request("/api/auth/get-session", "GET", cookie);
    expect(response.status).toBe(200);
    return sessionSchema.parse(await response.json());
  }
  async function accounts(cookie: string) {
    const response = await request("/api/auth/list-accounts", "GET", cookie);
    expect(response.status).toBe(200);
    return accountsSchema.parse(await response.json());
  }
  async function privateAccess(cookie: string, status: number) {
    expect((await request("/api/bookmarks", "GET", cookie)).status).toBe(
      status,
    );
  }
  async function passwordSessions() {
    const signup = await request("/api/auth/sign-up/email", "POST", "", {
      email,
      name: "Password Reader",
      password: oldPassword,
    });
    expect(signup.status).toBe(200);
    const verified = await app.request(
      delivered("Verify your email"),
      undefined,
      env,
    );
    expect([200, 302]).toContain(verified.status);
    // Two independent logins, with no incoming cookie/client jar.
    const first = await login(oldPassword);
    const second = await login(oldPassword);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const cookies = [sessionCookie(first), sessionCookie(second)] as const;
    expect(cookies[0] === cookies[1]).toBe(false);
    const firstIdentity = await identity(cookies[0]);
    const secondIdentity = await identity(cookies[1]);
    expect(firstIdentity.session.id === secondIdentity.session.id).toBe(false);
    expect(firstIdentity.user.id).toBe(secondIdentity.user.id);
    return cookies;
  }
  async function resetToken() {
    const response = await request(
      "/api/auth/request-password-reset",
      "POST",
      "",
      {
        email,
        redirectTo: "/reset-password",
      },
    );
    expect(response.status).toBe(200);
    const redirect = await app.request(
      delivered("Reset your password"),
      undefined,
      env,
    );
    expect(redirect.status).toBe(302);
    const target = new URL(redirect.headers.get("location")!, origin);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/reset-password");
    const token = target.searchParams.get("token");
    if (!token) throw new Error("Expected an official password reset token");
    return token;
  }
  function reset(token: string) {
    return request("/api/auth/reset-password", "POST", "", {
      token,
      newPassword,
    });
  }
  function change(cookie: string, currentPassword = oldPassword) {
    return request("/api/auth/change-password", "POST", cookie, {
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
  }

  it.each(["Magic-Link-only", "Google-linked passwordless fixture"] as const)(
    "characterizes first password via official reset for %s without changing identity",
    async (kind) => {
      expect(
        (
          await request("/api/auth/sign-in/magic-link", "POST", "", {
            email,
            name: "Passwordless Reader",
            callbackURL: "/",
          })
        ).status,
      ).toBe(200);
      const verified = await app.request(delivered("Sign in"), undefined, env);
      expect(verified.status).toBe(302);
      const cookie = sessionCookie(verified);
      const before = await identity(cookie);
      expect(before.user.emailVerified).toBe(true);
      expect(await accounts(cookie)).toEqual([]);
      if (kind === "Google-linked passwordless fixture") {
        // Owned schema fixture only: add Google metadata without a password or tokens.
        // The session still comes from a real Magic Link, never mocked Google consent.
        const now = Math.floor(Date.now() / 1000);
        await database.binding
          .prepare(
            "INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            "fixture-google-account",
            "fixture-google-subject",
            "google",
            before.user.id,
            now,
            now,
          )
          .run();
        expect(
          (await accounts(cookie)).map((value) => value.providerId),
        ).toEqual(["google"]);
      }
      expect((await login(newPassword)).status).toBe(401);
      expect(
        (await accounts(cookie)).some(
          (value) => value.providerId === "credential",
        ),
      ).toBe(false);

      const token = await resetToken();
      const established = await reset(token);
      expect(established.status).toBe(200);
      expect(await established.json()).toEqual({ status: true });
      expect(hasSessionCookie(established)).toBe(false);
      const credential = (await accounts(cookie)).filter(
        (value) => value.providerId === "credential",
      );
      expect(credential).toEqual([
        {
          providerId: "credential",
          accountId: before.user.id,
          userId: before.user.id,
        },
      ]);
      const signedIn = await login(newPassword);
      expect(signedIn.status).toBe(200);
      const after = await identity(sessionCookie(signedIn));
      expect(after.user).toEqual(before.user);
      expect((await identity(cookie)).user).toEqual(before.user);
      await privateAccess(cookie, 200);
      const reused = await reset(token);
      expect(reused.status).toBe(400);
      expect(hasSessionCookie(reused)).toBe(false);
    },
  );

  it("characterizes changePassword revoking every old session and issuing a usable replacement cookie", async () => {
    const [first, second] = await passwordSessions();
    const before = await identity(first);
    const changed = await change(first);
    expect(changed.status).toBe(200);
    expect(hasSessionCookie(changed)).toBe(true);
    const replacement = sessionCookie(changed);
    expect(replacement === first || replacement === second).toBe(false);
    const after = await identity(replacement);
    expect(after.user).toEqual(before.user);
    expect(after.session.id === before.session.id).toBe(false);
    await privateAccess(first, 401);
    await privateAccess(second, 401);
    await privateAccess(replacement, 200);
    expect((await login(oldPassword)).status).toBe(401);
    const signedIn = await login(newPassword);
    expect(signedIn.status).toBe(200);
    await privateAccess(sessionCookie(signedIn), 200);
  });

  it("characterizes incorrect current password leaving password and both sessions unchanged", async () => {
    const [first, second] = await passwordSessions();
    const before = [await identity(first), await identity(second)];
    const rejected = await change(first, "incorrect-current-password");
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: "INVALID_PASSWORD" });
    expect(hasSessionCookie(rejected)).toBe(false);
    expect((await identity(first)).session.id).toBe(before[0]!.session.id);
    expect((await identity(second)).session.id).toBe(before[1]!.session.id);
    await privateAccess(first, 200);
    await privateAccess(second, 200);
    expect((await login(oldPassword)).status).toBe(200);
    expect((await login(newPassword)).status).toBe(401);
  });

  it("characterizes current reset policy retaining both existing sessions without minting a login cookie", async () => {
    const [first, second] = await passwordSessions();
    const before = [await identity(first), await identity(second)];
    const response = await reset(await resetToken());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(hasSessionCookie(response)).toBe(false);
    expect((await identity(first)).session.id).toBe(before[0]!.session.id);
    expect((await identity(second)).session.id).toBe(before[1]!.session.id);
    await privateAccess(first, 200);
    await privateAccess(second, 200);
    expect((await login(oldPassword)).status).toBe(401);
    expect((await login(newPassword)).status).toBe(200);
  });

  it.each(["revocation", "replacement session creation"] as const)(
    "characterizes partial changePassword failure at %s after password update",
    async (stage) => {
      const [first, second] = await passwordSessions();
      const sessionTokens = [
        (await identity(first)).session.token,
        (await identity(second)).session.token,
      ];
      let failures = 0;
      const captured = ["error", "warn", "info", "log"].map((level) =>
        vi
          .spyOn(console, level as "error" | "warn" | "info" | "log")
          .mockImplementation(() => undefined),
      );
      env.DB = faultD1Queries(database.binding, (sql) => {
        const matches =
          stage === "revocation"
            ? /^delete\s+from\s+"session"/i.test(sql)
            : /^insert\s+into\s+"session"/i.test(sql);
        if (matches) failures++;
        return matches;
      });
      const failed = await change(first);
      expect(failures).toBe(1);
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({
        code: "AUTH_FAILURE",
        message: "Authentication request failed. Please try again.",
      });
      expect(hasSessionCookie(failed)).toBe(false);
      expect(failed.headers.get("cache-control")).toBe("private, no-store");
      env.DB = database.binding; // Restore transport before observing committed effects.
      const oldSessionStatus = stage === "revocation" ? 200 : 401;
      await privateAccess(first, oldSessionStatus);
      await privateAccess(second, oldSessionStatus);
      expect((await login(oldPassword)).status).toBe(401);
      const recovered = await login(newPassword);
      expect(recovered.status).toBe(200);
      await privateAccess(sessionCookie(recovered), 200);
      const serialized = JSON.stringify(
        captured.flatMap((capture) => capture.mock.calls),
      );
      expect(serialized.includes("auth.endpoint_failed")).toBe(true);
      // Boolean assertions avoid printing credential/token values in failure diagnostics.
      const sensitive = [
        oldPassword,
        newPassword,
        first,
        second,
        ...sessionTokens,
        env.AUTH_SECRET,
        email,
        ...sent.map((message) => message.text),
        ...sent
          .map((message) => new URL(message.text).searchParams.get("token"))
          .filter((value): value is string => Boolean(value)),
      ];
      for (const value of sensitive)
        expect(serialized.includes(value)).toBe(false);
    },
  );
});
