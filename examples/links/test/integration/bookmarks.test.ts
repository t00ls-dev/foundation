import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/server/app.js";
import type { Env } from "../../src/server/auth.js";
import {
  bookmarkListSchema,
  bookmarkResponseSchema,
} from "../../src/shared/bookmarks.js";
import { applyMigrations, createTestDatabase, faultD1Queries } from "../d1.js";

describe("Links API with Better Auth and real D1", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let env: Env;
  const sent: Array<{ to: string; text: string; subject: string }> = [];
  const emailFactory = () => ({
    send(input: { to: string; text: string; subject: string }) {
      sent.push(input);
      return Promise.resolve();
    },
  });
  let app: ReturnType<typeof createApp>;
  const origin = "http://localhost:3000";
  const input = {
    title: "Foundation 100%",
    url: "https://example.com/docs",
    description: "Private reference",
    tags: [" Docs ", "work"],
  };

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
    app = createApp(emailFactory);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await database.miniflare.dispose();
  });

  function request(
    path: string,
    method = "GET",
    cookie = "",
    body?: unknown,
    requestOrigin: string | null = origin,
  ) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (cookie) headers.set("Cookie", cookie);
    if (requestOrigin) headers.set("Origin", requestOrigin);
    return app.request(
      `${origin}${path}`,
      {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env,
    );
  }
  async function register(email: string) {
    const credentials = { email, password: "correct-horse-battery-staple" };
    expect(
      (
        await request("/api/auth/sign-up/email", "POST", "", {
          ...credentials,
          name: "Person",
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/auth/sign-in/email", "POST", "", credentials))
        .status,
    ).toBe(403);
    const verification = sent.find(
      (message) =>
        message.to === email && message.subject === "Verify your email",
    );
    expect(verification).toBeDefined();
    const verified = await app.request(verification!.text, undefined, env);
    expect([200, 302]).toContain(verified.status);
    const login = await request(
      "/api/auth/sign-in/email",
      "POST",
      "",
      credentials,
    );
    expect(login.status).toBe(200);
    expect(login.headers.getSetCookie().join(";")).toContain("HttpOnly");
    expect(login.headers.getSetCookie().join(";").toLowerCase()).toContain(
      "samesite=lax",
    );
    return login.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }
  async function create(cookie: string, value = input) {
    const response = await request("/api/bookmarks", "POST", cookie, value);
    expect(response.status).toBe(201);
    return bookmarkResponseSchema.parse(await response.json());
  }

  it("exposes only the server Google capability and does not consult D1", async () => {
    const prepare = vi.spyOn(env.DB, "prepare");
    const disabled = await request("/api/config");
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({
      googleEnabled: false,
      turnstile: { status: "disabled" },
    });
    expect(disabled.headers.get("cache-control")).toBe("private, no-store");
    env.GOOGLE_CLIENT_ID = "capability-client-id";
    env.GOOGLE_CLIENT_SECRET = "capability-client-secret";
    const enabled = await request("/api/config");
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({
      googleEnabled: true,
      turnstile: { status: "disabled" },
    });
    expect(enabled.headers.get("cache-control")).toBe("private, no-store");
    expect(prepare).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("returns only password presence for the authoritative current user", async () => {
    const cookie = await register("password@example.com");
    const response = await request("/api/account/security", "GET", cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasPassword: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await request("/api/account/security")).status).toBe(401);
    expect(
      (
        await request(
          "/api/account/security",
          "GET",
          "better-auth.session_token=invalid",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/api/account/security?userId=other&email=other@example.com",
          "GET",
          cookie,
        )
      ).status,
    ).toBe(400);
  });

  it("reports passwordless users without using a last-login/provider heuristic", async () => {
    const passwordCookie = await register("password@example.com");
    expect(
      (
        await request("/api/auth/sign-in/magic-link", "POST", "", {
          email: "magic@example.com",
          callbackURL: "/",
        })
      ).status,
    ).toBe(200);
    const link = sent.find(
      (value) =>
        value.to === "magic@example.com" && value.subject === "Sign in",
    )!;
    const verified = await app.request(link.text, undefined, env);
    const magicCookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const response = await request("/api/account/security", "GET", magicCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasPassword: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // User with a password still has one even when their current login is Magic Link.
    expect(
      (
        await request("/api/auth/sign-in/magic-link", "POST", "", {
          email: "password@example.com",
          callbackURL: "/",
        })
      ).status,
    ).toBe(200);
    const passwordLink = sent.find(
      (value) =>
        value.to === "password@example.com" && value.subject === "Sign in",
    )!;
    const login = await app.request(passwordLink.text, undefined, env);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(
      await (await request("/api/account/security", "GET", cookie)).json(),
    ).toEqual({ hasPassword: true });
    expect(
      await (
        await request("/api/account/security", "GET", passwordCookie)
      ).json(),
    ).toEqual({ hasPassword: true });
  });

  it("does not load hashes and fails rather than returning false on account query failure", async () => {
    const cookie = await register("password@example.com");
    let accountRead = "";
    env.DB = faultD1Queries(database.binding, (sql) => {
      if (/^select.*from\s+"account"/i.test(sql)) {
        accountRead = sql;
        return true;
      }
      return false;
    });
    const failed = await request("/api/account/security", "GET", cookie);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
      },
    });
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
    expect(
      accountRead.toLowerCase().startsWith('select 1 from "account"'),
    ).toBe(true);
  });

  it.each(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const)(
    "fails explicitly without leaking an incomplete Google configuration (%s)",
    async (key) => {
      env[key] = "sensitive-credential-value";
      const captured = [
        vi.spyOn(console, "error"),
        vi.spyOn(console, "warn"),
        vi.spyOn(console, "info"),
        vi.spyOn(console, "log"),
      ];
      for (const capture of captured)
        capture.mockImplementation(() => undefined);
      for (const response of [
        await request("/api/config"),
        await request("/api/auth/sign-in/social", "POST", "", {
          provider: "google",
          callbackURL: "/",
        }),
      ]) {
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: {
            code: "AUTH_CONFIGURATION_INVALID",
            message: "Authentication is temporarily unavailable.",
          },
        });
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.getSetCookie()).toEqual([]);
      }
      expect(
        JSON.stringify(captured.flatMap((capture) => capture.mock.calls)),
      ).not.toMatch(
        /sensitive-credential-value|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET/,
      );
      expect((await request("/health")).status).toBe(200);
    },
  );

  it("does not configure Google when absent and preserves the Better Auth error endpoint", async () => {
    const start = await request("/api/auth/sign-in/social", "POST", "", {
      provider: "google",
      callbackURL: "/",
    });
    expect(start.status).toBe(404);
    expect(start.headers.getSetCookie()).toEqual([]);
    const errorPage = await request("/api/auth/error?error=state_mismatch");
    expect(errorPage.headers.get("content-type")).toContain("text/html");
  });

  it("starts Google through Better Auth and returns cancellation to the fixed login URL", async () => {
    env.GOOGLE_CLIENT_ID = "oauth-client-id";
    env.GOOGLE_CLIENT_SECRET = "secret-must-stay-server-only";
    const start = await request("/api/auth/sign-in/social", "POST", "", {
      provider: "google",
      callbackURL: "/",
      newUserCallbackURL: "/",
      errorCallbackURL: "/login?oauth=failed",
    });
    expect(start.status).toBe(200);
    const body = await start.text();
    expect(body).not.toContain(env.GOOGLE_CLIENT_SECRET);
    const { url } = z.object({ url: z.string() }).parse(JSON.parse(body));
    const authorization = new URL(url);
    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("client_id")).toBe(
      env.GOOGLE_CLIENT_ID,
    );
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      `${origin}/api/auth/callback/google`,
    );
    expect(authorization.searchParams.get("code_challenge")).toBeTruthy();
    const state = authorization.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookie = start.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const canceled = await request(
      `/api/auth/callback/google?state=${encodeURIComponent(state!)}&error=access_denied`,
      "GET",
      cookie,
    );
    expect(canceled.status).toBe(302);
    const target = new URL(canceled.headers.get("location")!, origin);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("oauth")).toBe("failed");
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.has("state")).toBe(false);
    expect(canceled.headers.getSetCookie().join(";")).not.toContain(
      "session_token",
    );
    expect((await request("/api/bookmarks")).status).toBe(401);
    const untrusted = await request("/api/auth/sign-in/social", "POST", "", {
      provider: "google",
      callbackURL: "https://attacker.example",
      errorCallbackURL: "https://attacker.example",
    });
    expect(untrusted.status).toBe(403);
  });

  it("isolates OAuth state from Magic Link and preserves email/password/reset on D1", async () => {
    env.GOOGLE_CLIENT_ID = "test-google-client";
    env.GOOGLE_CLIENT_SECRET = "test-google-secret";
    const email = "security@example.com";
    await register(email);
    sent.splice(0);
    const start = await request("/api/auth/sign-in/social", "POST", "", {
      provider: "google",
      callbackURL: "/",
      additionalData: { email },
    });
    expect(start.status).toBe(200);
    const authorization = await start.json<{ url: string }>();
    const state = new URL(authorization.url).searchParams.get("state");
    expect(state).toBeTruthy();
    const forged = await request(
      `/api/auth/magic-link/verify?token=${encodeURIComponent(state!)}&callbackURL=/`,
    );
    expect(forged.status).toBe(302);
    expect(
      new URL(forged.headers.get("location")!).searchParams.get("error"),
    ).toBe("INVALID_TOKEN");
    expect(forged.headers.getSetCookie().join(";")).not.toContain(
      "session_token",
    );
    expect(sent).toHaveLength(0);
    expect((await request("/api/bookmarks")).status).toBe(401);

    expect(
      (
        await request("/api/auth/sign-in/magic-link", "POST", "", {
          email,
          callbackURL: "/",
        })
      ).status,
    ).toBe(200);
    const link = sent.find((message) => message.subject === "Sign in")!;
    const verified = await app.request(link.text, undefined, env);
    expect(verified.status).toBe(302);
    const cookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");
    expect((await request("/api/bookmarks", "GET", cookie)).status).toBe(200);
    expect(
      (await request("/api/auth/sign-out", "POST", cookie, {})).status,
    ).toBe(200);
    expect((await request("/api/bookmarks", "GET", cookie)).status).toBe(401);

    expect(
      (
        await request("/api/auth/request-password-reset", "POST", "", {
          email,
          redirectTo: "/reset-password",
        })
      ).status,
    ).toBe(200);
    const reset = sent.find(
      (message) => message.subject === "Reset your password",
    )!;
    const redirect = await app.request(reset.text, undefined, env);
    expect(redirect.status).toBe(302);
    const token = new URL(redirect.headers.get("location")!).searchParams.get(
      "token",
    );
    expect(token).toBeTruthy();
    const newPassword = "new-correct-horse-battery-staple";
    expect(
      (
        await request("/api/auth/reset-password", "POST", "", {
          token,
          newPassword,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/api/auth/sign-in/email", "POST", "", {
          email,
          password: "correct-horse-battery-staple",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/api/auth/sign-in/email", "POST", "", {
          email,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/api/auth/reset-password", "POST", "", {
          token,
          newPassword,
        })
      ).status,
    ).toBe(400);
  });

  it("persists CRUD, normalizes tags, filters literal search and paginates", async () => {
    const cookie = await register("a@example.com");
    const first = await create(cookie);
    expect(first.tags).toEqual(["docs", "work"]);
    const titleOnly = await request(
      `/api/bookmarks/${first.id}`,
      "PATCH",
      cookie,
      { title: first.title },
    );
    expect(bookmarkResponseSchema.parse(await titleOnly.json())).toMatchObject({
      description: input.description,
      tags: ["docs", "work"],
    });
    await create(cookie, { ...input, title: "Other", tags: ["personal"] });
    const list = bookmarkListSchema.parse(
      await (await request("/api/bookmarks?limit=1", "GET", cookie)).json(),
    );
    expect(list.items).toHaveLength(1);
    expect(list.hasMore).toBe(true);
    const secondPage = bookmarkListSchema.parse(
      await (
        await request("/api/bookmarks?limit=1&offset=1", "GET", cookie)
      ).json(),
    );
    expect(secondPage.items[0]?.id).not.toBe(list.items[0]?.id);
    expect(secondPage.hasMore).toBe(false);
    for (const query of ["q=100%25", "tag=DOCS", "q=reference&tag=docs"]) {
      const filtered = bookmarkListSchema.parse(
        await (await request(`/api/bookmarks?${query}`, "GET", cookie)).json(),
      );
      expect(filtered.items.map((item) => item.id)).toEqual([first.id]);
    }
    expect(
      bookmarkListSchema.parse(
        await (await request("/api/bookmarks?q=_", "GET", cookie)).json(),
      ).items,
    ).toEqual([]);
    const updated = bookmarkResponseSchema.parse(
      await (
        await request(`/api/bookmarks/${first.id}`, "PATCH", cookie, {
          title: "Edited",
          description: null,
          tags: ["New"],
        })
      ).json(),
    );
    expect(updated).toMatchObject({
      title: "Edited",
      description: null,
      tags: ["new"],
    });
    app = createApp(emailFactory);
    expect(
      bookmarkResponseSchema.parse(
        await (
          await request(`/api/bookmarks/${first.id}`, "GET", cookie)
        ).json(),
      ).title,
    ).toBe("Edited");
    expect(
      (await request(`/api/bookmarks/${first.id}`, "DELETE", cookie)).status,
    ).toBe(204);
    expect(
      (await request(`/api/bookmarks/${first.id}`, "GET", cookie)).status,
    ).toBe(404);
  });

  it("isolates every operation and filter between A and B", async () => {
    const a = await register("a@example.com");
    const b = await register("b@example.com");
    const item = await create(a);
    for (const query of [
      "",
      "?q=Private",
      "?tag=docs",
      "?q=Foundation&tag=docs&limit=1&offset=0",
    ]) {
      const response = await request(`/api/bookmarks${query}`, "GET", b);
      expect(response.status).toBe(200);
      expect(bookmarkListSchema.parse(await response.json())).toEqual({
        items: [],
        hasMore: false,
      });
    }
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const response = await request(
        `/api/bookmarks/${item.id}`,
        method,
        b,
        method === "PATCH" ? { title: "Stolen" } : undefined,
      );
      const missing = await request(
        `/api/bookmarks/${crypto.randomUUID()}`,
        method,
        b,
        method === "PATCH" ? { title: "Stolen" } : undefined,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(await missing.json());
    }
    expect(
      (await request("/api/bookmarks", "POST", b, { ...input, userId: "a" }))
        .status,
    ).toBe(400);
    expect(
      (await request(`/api/bookmarks/${item.id}`, "PATCH", a, { userId: "b" }))
        .status,
    ).toBe(400);
    expect((await request("/api/bookmarks?userId=a", "GET", b)).status).toBe(
      400,
    );
    expect(
      bookmarkResponseSchema.parse(
        await (await request(`/api/bookmarks/${item.id}`, "GET", a)).json(),
      ),
    ).toEqual(item);
    expect(
      await database.binding
        .prepare("SELECT count(*) AS total FROM bookmark")
        .first(),
    ).toEqual({ total: 1 });
  });

  it("rejects missing, invalid, expired and revoked sessions on every route", async () => {
    const cookie = await register("a@example.com");
    const item = await create(cookie);
    const operations = [
      ["/api/bookmarks", "GET", undefined],
      ["/api/bookmarks", "POST", input],
      [`/api/bookmarks/${item.id}`, "GET", undefined],
      [`/api/bookmarks/${item.id}`, "PATCH", { title: "Forbidden" }],
      [`/api/bookmarks/${item.id}`, "DELETE", undefined],
    ] as const;
    for (const invalidCookie of ["", "better-auth.session_token=invalid"]) {
      for (const [path, method, body] of operations)
        expect((await request(path, method, invalidCookie, body)).status).toBe(
          401,
        );
    }
    await database.binding
      .prepare("UPDATE session SET expires_at = ?")
      .bind(Math.floor(Date.now() / 1000) - 10)
      .run();
    for (const [path, method, body] of operations)
      expect((await request(path, method, cookie, body)).status).toBe(401);
    const fresh = await register("b@example.com");
    expect(
      (await request("/api/auth/sign-out", "POST", fresh, {})).status,
    ).toBe(200);
    for (const [path, method, body] of operations)
      expect((await request(path, method, fresh, body)).status).toBe(401);
  });

  it("does not confirm failed revocation, does not renew, and allows a real retry", async () => {
    const cookie = await register("a@example.com");
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 86400;
    await database.binding
      .prepare("UPDATE session SET expires_at = ?")
      .bind(expiresAt)
      .run();
    let failDelete = true;
    let updates = 0;
    env.DB = faultD1Queries(database.binding, (sql) => {
      if (/^update\s+"session"/i.test(sql)) updates++;
      return failDelete && /^delete\s+from\s+"session"/i.test(sql);
    });
    const failed = await request("/api/auth/sign-out", "POST", cookie, {});
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      code: "LOGOUT_UNCONFIRMED",
      message: "Could not confirm sign out. Please try again.",
    });
    expect(failed.headers.getSetCookie()).toEqual([]);
    expect(failed.headers.get("Cache-Control")).toBe("private, no-store");
    expect(updates).toBe(0);
    expect(
      await database.binding.prepare("SELECT expires_at FROM session").first(),
    ).toEqual({ expires_at: expiresAt });

    failDelete = false;
    // A failed logout is not revocation: recovery still accepts the old cookie.
    expect((await request("/api/bookmarks", "GET", cookie)).status).toBe(200);
    const retried = await request("/api/auth/sign-out", "POST", cookie, {});
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ success: true });
    const cookies = retried.headers.getSetCookie();
    for (const name of ["session_token", "session_data", "dont_remember"]) {
      expect(
        cookies.some(
          (value) => value.includes(name) && value.includes("Max-Age=0"),
        ),
      ).toBe(true);
    }
    expect(
      await database.binding.prepare("SELECT id FROM session").first(),
    ).toBeNull();
    expect((await request("/api/bookmarks", "GET", cookie)).status).toBe(401);
  });

  it("fails closed when the post-logout authoritative read is unavailable", async () => {
    const cookie = await register("a@example.com");
    let deleted = false;
    env.DB = faultD1Queries(database.binding, (sql) => {
      if (/^delete\s+from\s+"session"/i.test(sql)) deleted = true;
      return deleted && /^select.*from\s+"session"/i.test(sql);
    });
    const response = await request("/api/auth/sign-out", "POST", cookie, {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "LOGOUT_UNCONFIRMED" });
    expect(response.headers.getSetCookie()).toEqual([]);
    env.DB = database.binding;
    expect((await request("/api/bookmarks", "GET", cookie)).status).toBe(401);
    expect(
      (await request("/api/auth/sign-out", "POST", cookie, {})).status,
    ).toBe(200);
  });

  it("sanitizes logs from failures during Drizzle query execution", async () => {
    const cookie = await register("a@example.com");
    const stored = await database.binding
      .prepare("SELECT token FROM session")
      .first<{ token: string }>();
    expect(stored).not.toBeNull();
    const captures = ["error", "warn", "info", "log"].map((name) =>
      vi
        .spyOn(console, name as "error" | "warn" | "info" | "log")
        .mockImplementation(() => undefined),
    );
    // This database is disposable. Force a native D1 execution error so Drizzle
    // wraps the real token-bearing lookup SQL/params, not a mocked prepare error.
    await database.binding.prepare("DROP TABLE session").run();
    const failure = await request("/api/bookmarks", "GET", cookie);
    expect(failure.status).toBe(500);
    const authFailure = await request("/api/auth/get-session", "GET", cookie);
    expect(authFailure.status).toBe(500);
    const calls = captures.flatMap((capture) => capture.mock.calls);
    expect(calls.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(calls);
    expect(serialized).toContain("auth.internal_error");
    for (const sensitive of [
      stored!.token,
      cookie,
      env.AUTH_SECRET,
      "a@example.com",
      "params:",
      "select ",
      "simulated D1 execution failure",
      ...sent.map((message) => message.text),
      ...sent
        .map((message) => new URL(message.text).searchParams.get("token")!)
        .filter(Boolean),
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
    for (const call of calls) {
      expect(call).toHaveLength(1);
      expect(JSON.parse(String(call[0]))).toMatchObject({
        component: "foundation.auth",
        level: "error",
      });
    }
  });

  it("rejects cross-origin and missing-origin mutations without changing data", async () => {
    const cookie = await register("a@example.com");
    const item = await create(cookie);
    for (const requestOrigin of ["https://attacker.example", null]) {
      for (const [path, method, body] of [
        ["/api/bookmarks", "POST", input],
        [`/api/bookmarks/${item.id}`, "PATCH", { title: "Forbidden" }],
        [`/api/bookmarks/${item.id}`, "DELETE", undefined],
      ] as const) {
        const response = await request(
          path,
          method,
          cookie,
          body,
          requestOrigin,
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: "FORBIDDEN" },
        });
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
    }
    expect(
      bookmarkResponseSchema.parse(
        await (
          await request(`/api/bookmarks/${item.id}`, "GET", cookie)
        ).json(),
      ),
    ).toEqual(item);
    expect(
      (
        await request(
          "/api/auth/sign-out",
          "POST",
          cookie,
          {},
          "https://attacker.example",
        )
      ).status,
    ).toBe(403);
  });

  it("propagates session refresh and cleanup cookies and private headers", async () => {
    const cookie = await register("a@example.com");
    const now = Math.floor(Date.now() / 1000);
    await database.binding
      .prepare("UPDATE session SET expires_at = ?, updated_at = ?")
      .bind(now + 5 * 86400, now - 2 * 86400)
      .run();
    const response = await request("/api/bookmarks", "GET", cookie);
    expect(response.status).toBe(200);
    expect(
      response.headers
        .getSetCookie()
        .some(
          (value) =>
            value.includes("session_token=") && value.includes("Max-Age="),
        ),
    ).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
    await database.binding
      .prepare("UPDATE session SET expires_at = ?")
      .bind(now - 1)
      .run();
    const expired = await request("/api/bookmarks", "GET", cookie);
    expect(expired.status).toBe(401);
    const cleanupCookies = expired.headers.getSetCookie();
    expect(cleanupCookies.length).toBeGreaterThanOrEqual(3);
    for (const name of ["session_token", "session_data", "dont_remember"]) {
      expect(
        cleanupCookies.some(
          (value) => value.includes(name) && value.includes("Max-Age=0"),
        ),
      ).toBe(true);
    }
    expect(
      expired.headers
        .getSetCookie()
        .some((value) => value.includes("Max-Age=0")),
    ).toBe(true);
    expect(expired.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("validates payloads and preserves health and API fallback contracts", async () => {
    const cookie = await register("a@example.com");
    const minimal = await request("/api/bookmarks", "POST", cookie, {
      title: "Minimal",
      url: input.url,
    });
    expect(minimal.status).toBe(201);
    const minimalItem = bookmarkResponseSchema.parse(await minimal.json());
    expect(minimalItem).toMatchObject({ description: null, tags: [] });
    expect(
      (
        await request("/api/bookmarks", "POST", cookie, {
          ...input,
          tags: ["one,two"],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/api/bookmarks/${minimalItem.id}`, "PATCH", cookie, {
          tags: ["one,two"],
        })
      ).status,
    ).toBe(400);
    const partial = await request(
      `/api/bookmarks/${minimalItem.id}`,
      "PATCH",
      cookie,
      { title: "Changed" },
    );
    expect(bookmarkResponseSchema.parse(await partial.json())).toMatchObject({
      title: "Changed",
      description: null,
      tags: [],
    });
    expect(
      (
        await request("/api/bookmarks", "POST", cookie, {
          ...input,
          url: "javascript:alert(1)",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/bookmarks", "POST", cookie, {
          ...input,
          description: "x".repeat(17000),
        })
      ).status,
    ).toBe(413);
    expect(
      (await request("/api/bookmarks?limit=101", "GET", cookie)).status,
    ).toBe(400);
    const malformed = await app.request(
      `${origin}/api/bookmarks`,
      {
        method: "POST",
        headers: {
          "Cookie": cookie,
          "Origin": origin,
          "Content-Type": "application/json",
        },
        body: "{",
      },
      env,
    );
    expect(malformed.status).toBe(400);
    expect((await request("/api/missing")).status).toBe(404);
    expect((await request("/health")).headers.get("Cache-Control")).toBe(
      "no-store",
    );
    const broken = {
      ...env,
      DB: {
        prepare() {
          throw new Error("internal database secret");
        },
      } as unknown as D1Database,
    };
    const health = await app.request(`${origin}/health`, undefined, broken);
    expect(health.status).toBe(503);
    expect(await health.text()).not.toContain("internal database secret");
    const failure = await app.request(
      `${origin}/api/bookmarks`,
      { headers: { Cookie: cookie } },
      broken,
    );
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain("internal database secret");
    expect(failure.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
