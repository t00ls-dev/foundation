import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/server/app.js";
import type { Env } from "../../src/server/auth.js";
import { applyMigrations, createTestDatabase, faultD1Queries } from "../d1.js";
import { extractEmailUrl } from "../email-link.js";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let env: Env;
let action: string;
const sent: Array<{ subject: string; text: string }> = [];
const origin = "http://localhost:3000";
const app = createApp(() => ({
  send: (input) => {
    sent.push(input);
    return Promise.resolve();
  },
}));
beforeEach(async () => {
  database = await createTestDatabase();
  await applyMigrations(database.binding);
  sent.length = 0;
  action = "links-sign-up";
  env = {
    DB: database.binding,
    BASE_URL: origin,
    AUTH_SECRET: "fixture-auth-secret-at-least-thirty-two-characters",
    EMAIL_FROM: "fixture@example.com",
    RESEND_API_KEY: "unused",
    ASSETS: { fetch: () => Promise.resolve(new Response("SPA")) },
    TURNSTILE_SITE_KEY: "fixture-public-key",
    TURNSTILE_SECRET_KEY: "fixture-secret-key",
  };
  const original = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return url === "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      ? Promise.resolve(
          Response.json({ success: true, hostname: "localhost", action }),
        )
      : original(input, init);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.miniflare.dispose();
});
function post(path: string, token: boolean = true) {
  return app.request(
    `${origin}/api/auth${path}`,
    {
      method: "POST",
      headers: {
        "Origin": origin,
        "Content-Type": "application/json",
        ...(token ? { "x-captcha-response": "ephemeral-fixture" } : {}),
      },
      body: JSON.stringify({
        name: "Reader",
        email: "reader@example.com",
        password: "correct-horse-battery-staple",
        redirectTo: "/reset-password",
      }),
    },
    env,
  );
}

it("capability exposes only public key, uses no auth query, and partial config keeps excluded endpoints independent", async () => {
  const prepare = vi.spyOn(env.DB, "prepare");
  const response = await app.request(`${origin}/api/config`, undefined, env);
  expect(await response.json()).toEqual({
    googleEnabled: false,
    turnstile: { status: "enabled", siteKey: "fixture-public-key" },
  });
  expect(prepare).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  delete env.TURNSTILE_SITE_KEY;
  expect((await post("/sign-in/email")).status).toBe(503);
  const session = await app.request(
    `${origin}/api/auth/get-session`,
    undefined,
    env,
  );
  expect(session.status).toBe(200);
  expect((await session.json()) === null).toBe(true);
});

it("valid Siteverify precedes real D1 auth and later execution failures remain AUTH_STATE_INDETERMINATE", async () => {
  expect((await post("/sign-up/email", false)).status).toBe(400);
  expect(sent).toHaveLength(0);
  expect((await post("/sign-up/email")).status).toBe(200);
  await app.request(extractEmailUrl(sent[0]!.text, origin), undefined, env);
  action = "links-sign-in";
  const login = await post("/sign-in/email");
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const session = await app.request(
    `${origin}/api/auth/get-session`,
    { headers: { Cookie: cookie } },
    env,
  );
  expect(
    z
      .object({ user: z.object({ email: z.string() }) })
      .parse(await session.json()).user.email,
  ).toBe("reader@example.com");
  // Failure occurs at execution in the existing D1 adapter, not a synthetic
  // HTTP status: CAPTCHA already permitted the real password endpoint.
  vi.mocked(globalThis.fetch).mockClear();
  env.DB = faultD1Queries(database.binding, (sql) =>
    sql.toLowerCase().includes('from "user"'),
  );
  const failed = await post("/sign-in/email");
  expect(failed.status).toBe(500);
  expect(await failed.json()).toMatchObject({
    code: "AUTH_STATE_INDETERMINATE",
  });
  expect(failed.headers.has("set-cookie")).toBe(false);
  expect(
    vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(
        ([input]) =>
          (input instanceof Request ? input.url : String(input)) ===
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      ),
  ).toHaveLength(1);
});
