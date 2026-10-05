import { memoryAdapter } from "better-auth/adapters/memory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { createFoundationAuth, type FoundationAuth } from "../src/index.js";

const origin = "http://localhost:3000";
const password = "correct-horse-battery-staple";
const actions = {
  signIn: "links-sign-in",
  signUp: "links-sign-up",
  magicLink: "links-magic-link",
  passwordReset: "links-password-reset",
};
const paths = [
  ["/sign-up/email", "signUp"],
  ["/sign-in/email", "signIn"],
  ["/sign-in/magic-link", "magicLink"],
  ["/request-password-reset", "passwordReset"],
] as const;

describe("opt-in Turnstile HTTP contract", () => {
  let auth: FoundationAuth;
  let verdict: unknown;
  const sent: Array<{ subject: string; text: string }> = [];
  const token = "ephemeral-fixture-captcha-token";
  const secret = "fixture-captcha-secret";
  let verify: MockInstance<typeof fetch>;
  beforeEach(() => {
    sent.length = 0;
    verdict = { success: true, hostname: "localhost", action: actions.signUp };
    verify = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json(verdict)));
    auth = makeAuth(true);
  });
  afterEach(() => vi.restoreAllMocks());
  function makeAuth(enabled: boolean, unavailable = false, rateLimit = false) {
    return createFoundationAuth({
      baseURL: origin,
      secret: "fixture-auth-secret-at-least-thirty-two-characters",
      database: memoryAdapter({
        user: [],
        account: [],
        session: [],
        verification: [],
        twoFactor: [],
        rateLimit: [],
      }),
      email: {
        send: (input) => {
          sent.push(input);
          return Promise.resolve();
        },
      },
      totp: { issuer: "Links", enrollmentEnabled: true },
      ...(rateLimit
        ? {
            rateLimit: {
              storage: "database" as const,
              enabled: true,
              ipAddressHeaders: ["cf-connecting-ip"],
            },
          }
        : {}),
      ...(enabled
        ? {
            turnstile: unavailable
              ? { unavailable: true as const }
              : { secretKey: secret, allowedHostnames: ["localhost"], actions },
          }
        : {}),
    });
  }
  function post(
    path: string,
    captchaToken: string | null = token,
    cookie = "",
    email = "reader@example.com",
  ) {
    return auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": origin,
          ...(captchaToken === null
            ? {}
            : { "x-captcha-response": captchaToken }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({
          email,
          password,
          name: "Reader",
          redirectTo: "/reset-password",
          callbackURL: "/bookmarks",
        }),
      }),
    );
  }
  it("without opt-in keeps existing requests and exposes no new auth APIs", async () => {
    auth = makeAuth(false);
    expect((await post("/sign-up/email", null)).status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    expect(Object.keys(auth).sort()).toEqual(["handler", "resolveSession"]);
  });
  it.each(paths)(
    "%s rejects missing/invalid/expired tokens before auth effects",
    async (path, operation) => {
      expect((await post(path, null)).status).toBe(400);
      expect(verify).not.toHaveBeenCalled();
      verdict = { "success": false, "error-codes": ["invalid-input-response"] };
      expect((await post(path)).status).toBe(403);
      verdict = { "success": false, "error-codes": ["timeout-or-duplicate"] };
      expect((await post(path)).status).toBe(403);
      expect(verify).toHaveBeenCalledTimes(2);
      expect(sent).toHaveLength(0);
      verdict = {
        success: true,
        hostname: "localhost",
        action: `${actions[operation]}-wrong`,
      };
      expect((await post(path)).status).toBe(403);
      verdict = {
        success: true,
        hostname: "other.example",
        action: actions[operation],
      };
      expect((await post(path)).status).toBe(403);
      expect(sent).toHaveLength(0);
    },
  );
  it.each(paths)(
    "%s delegates one action-bound Siteverify call when valid",
    async (path, operation) => {
      verdict = {
        success: true,
        hostname: "localhost",
        action: actions[operation],
      };
      const response = await post(path);
      expect(response.status).not.toBe(403);
      expect(response.status).toBeLessThan(500);
      expect(verify).toHaveBeenCalledTimes(1);
      const [url, init] = verify.mock.calls[0]!;
      expect(
        url instanceof Request ? url.url : url instanceof URL ? url.href : url,
      ).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      const body = JSON.parse(init!.body as string) as {
        secret: string;
        response: string;
      };
      expect(body.secret === secret && body.response === token).toBe(true);
    },
  );
  it.each([
    "/sign-in/social",
    "/two-factor/verify-totp",
    "/change-password",
    "/reset-password",
    "/update-user",
    "/sign-out",
  ])("does not captcha %s", async (path) => {
    await post(path, null);
    expect(verify).not.toHaveBeenCalled();
  });
  it("normalizes duplicate/trailing slashes and leaves unsupported GET to the router", async () => {
    expect((await post("/sign-up/email")).status).toBe(200);
    await auth.handler(new Request(sent[0]!.text));
    verify.mockClear();
    for (const path of [
      "/sign-in//email",
      "/sign-in/email/",
      "/sign-in/email?next=%2Faccount",
    ]) {
      expect((await post(path, null)).status).toBe(400);
    }
    await auth.handler(new Request(`${origin}/api/auth/sign-in/email`));
    expect(verify).not.toHaveBeenCalled();
    for (const path of [
      "/%73ign-in/email",
      "/sign-in/%65mail",
      "/sign-in%2Femail",
      "/sign-in/email//",
    ]) {
      const response = await post(path, null);
      expect([400, 404, 405]).toContain(response.status);
      expect(response.headers.has("set-cookie")).toBe(false);
    }
  });
  it("never bypasses reset for cookies, including an authoritative signed-in user", async () => {
    expect((await post("/sign-up/email")).status).toBe(200);
    await auth.handler(new Request(sent[0]!.text));
    verdict = { success: true, hostname: "localhost", action: actions.signIn };
    const signedIn = await post("/sign-in/email");
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const before = await auth.resolveSession(new Headers({ Cookie: cookie }));
    expect(before.data?.user.email).toBe("reader@example.com");
    verify.mockClear();
    sent.length = 0;
    expect((await post("/request-password-reset", null, cookie)).status).toBe(
      400,
    );
    expect(
      (
        await post(
          "/request-password-reset",
          null,
          "better-auth.session_token=invalid",
        )
      ).status,
    ).toBe(400);
    expect(verify).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    verdict = {
      success: true,
      hostname: "localhost",
      action: actions.passwordReset,
    };
    expect((await post("/request-password-reset", token, cookie)).status).toBe(
      200,
    );
    const after = await auth.resolveSession(new Headers({ Cookie: cookie }));
    expect(after.data?.session.id === before.data?.session.id).toBe(true);
    expect(sent).toHaveLength(1);
  });
  it.each(["network", "http", "null", "json"])(
    "classifies %s pre-auth failure without a false TOTP indeterminate outcome",
    async (failure) => {
      if (failure === "network")
        verify.mockRejectedValue(new TypeError(`upstream ${token} ${secret}`));
      if (failure === "http")
        verify.mockImplementation(() =>
          Promise.resolve(
            Response.json({ error: "unavailable" }, { status: 503 }),
          ),
        );
      if (failure === "null") verdict = null;
      if (failure === "json")
        verify.mockImplementation(() =>
          Promise.resolve(
            new Response("{bad", {
              headers: { "Content-Type": "application/json" },
            }),
          ),
        );
      const captured = [
        vi.spyOn(console, "warn"),
        vi.spyOn(console, "error"),
        vi.spyOn(console, "info"),
      ];
      captured.forEach((spy) => spy.mockImplementation(() => undefined));
      const response = await post("/sign-in/email");
      expect(response.status).toBe(failure === "json" ? 403 : 503);
      const data = (await response.json()) as { code: string };
      expect(data.code).toBe(
        failure === "json" ? "VERIFICATION_FAILED" : "TURNSTILE_UNAVAILABLE",
      );
      expect(verify).toHaveBeenCalledTimes(1);
      expect(sent).toHaveLength(0);
      const logs = JSON.stringify(captured.flatMap((spy) => spy.mock.calls));
      expect(logs.includes(token) || logs.includes(secret)).toBe(false);
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );
  it("native timeout remains bounded and has no automatic retry", async () => {
    verify.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("Fixture timeout")),
            { once: true },
          );
        }),
    );
    expect((await post("/sign-in/email")).status).toBe(503);
    expect(verify).toHaveBeenCalledTimes(1);
  }, 15000);
  it.each(["false", 1])(
    "explicitly preserves accepted native truthy-success limitation (%s)",
    async (success) => {
      verdict = { success, hostname: "localhost", action: actions.signUp };
      expect((await post("/sign-up/email")).status).toBe(200);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(sent).toHaveLength(1);
    },
  );
  it("partial config rejects only protected operations", async () => {
    auth = makeAuth(true, true);
    expect((await post("/sign-in/email")).status).toBe(503);
    await post("/two-factor/verify-totp", null);
    expect(verify).not.toHaveBeenCalled();
  });
  it("native database rate limiting counts missing tokens and runs before Siteverify", async () => {
    auth = makeAuth(true, false, true);
    for (let index = 0; index < 3; index++)
      expect((await post("/sign-in/email", null)).status).toBe(400);
    verdict = { success: true, hostname: "localhost", action: actions.signIn };
    const limited = await post("/sign-in/email");
    expect(limited.status).toBe(429);
    expect(limited.headers.has("X-Retry-After")).toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
});
