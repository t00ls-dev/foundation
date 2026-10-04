import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/server/app.js";
import { faultD1Queries } from "../d1.js";
import { createFoundationTotpHarness } from "../foundation-totp-harness.js";
import {
  type CookieJar,
  password,
  replacementPassword,
  totp,
  origin,
} from "../totp-harness.js";

describe("Foundation TOTP integration on the production Links D1 migration", () => {
  let h: Awaited<ReturnType<typeof createFoundationTotpHarness>>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T12:00:05Z"));
    h = await createFoundationTotpHarness();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await h?.database.miniflare.dispose();
  });
  async function error(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(
      z.object({ code: z.string() }).parse(await response.json()).code,
    ).toBe(code);
  }
  async function resolved(jar: CookieJar) {
    return h
      .foundationAuth()
      .resolveSession(new Headers({ Cookie: jar.header }));
  }

  it("uses only the wrapper surface, suppresses backup codes and aligns both public URIs to Links", async () => {
    expect(Object.keys(h.foundationAuth()).sort()).toEqual([
      "handler",
      "resolveSession",
    ]);
    const jar = await h.signup();
    const before = await resolved(jar);
    expect(before.data?.user.twoFactorEnabled).toBe(false);
    expect(before.headers).toBeInstanceOf(Headers);
    const uri = await h.enroll(jar);
    expect(new URL(uri).searchParams.get("issuer")).toBe("Links");
    expect(new URL(uri).searchParams.get("digits")).toBe("6");
    expect(new URL(uri).searchParams.get("period")).toBe("30");
    const recovered = await h.request("/two-factor/get-totp-uri", jar, {
      password,
    });
    expect(recovered.status).toBe(200);
    const other = z
      .object({ totpURI: z.string() })
      .parse(await recovered.json()).totpURI;
    expect(new URL(other).searchParams.get("issuer")).toBe("Links");
    expect(
      new URL(other).searchParams.get("secret") ===
        new URL(uri).searchParams.get("secret"),
    ).toBe(true);
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(false);
    await error(
      await h.request("/two-factor/enable", jar, { password, method: "otp" }),
      400,
      "OTP_DISABLED",
    );
    await error(
      await h.request("/two-factor/enable", jar, { password, issuer: "Other" }),
      400,
      "INVALID_TOTP_ISSUER",
    );
    const old = jar.copy();
    const confirmed = await h.verify(jar, totp(uri));
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers.getSetCookie().length).toBeGreaterThan(0);
    // Native body contains the old snapshot: cookies + public session are authoritative.
    expect(
      z
        .object({ user: z.object({ twoFactorEnabled: z.boolean() }) })
        .parse(await confirmed.json()).user.twoFactorEnabled,
    ).toBe(false);
    expect((await resolved(old)).data).toBeNull();
    const after = await resolved(jar);
    expect(after.data?.user.id === before.data?.user.id).toBe(true);
    expect(after.data?.session.id === before.data?.session.id).toBe(false);
    expect(after.data?.user.twoFactorEnabled).toBe(true);
  });

  it("allows TOTP enrollment in the Links handler without activating before confirmation", async () => {
    const jar = await h.signup();
    const app = createApp(() => ({ send: h.captureEmail }));
    const env = {
      DB: h.binding,
      BASE_URL: origin,
      AUTH_SECRET: "characterization-secret-at-least-thirty-two-characters",
      EMAIL_FROM: "test@example.com",
      RESEND_API_KEY: "unused",
      ASSETS: { fetch: () => Promise.resolve(new Response("SPA")) },
    };
    const response = await app.request(
      `${origin}/api/auth/two-factor/enable`,
      {
        method: "POST",
        headers: {
          "Cookie": jar.header,
          "Origin": origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password, method: "totp" }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const setup = z
      .object({ backupCodes: z.array(z.string()), totpURI: z.string() })
      .parse(await response.json());
    expect(setup.backupCodes).toEqual([]);
    expect(new URL(setup.totpURI).searchParams.get("issuer")).toBe("Links");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(false);
    const security = await app.request(
      `${origin}/api/account/security`,
      { headers: { Cookie: jar.header } },
      env,
    );
    expect(await security.json()).toEqual({ hasPassword: true });
  });

  it("rejects direct trusted-device requests before confirming or authenticating and leaves the challenge usable", async () => {
    const jar = await h.signup();
    const uri = await h.enroll(jar);
    const blocked = await h.verify(jar, totp(uri), true);
    await error(blocked, 400, "TRUSTED_DEVICE_DISABLED");
    expect(blocked.headers.getSetCookie()).toEqual([]);
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(false);
    expect((await h.verify(jar, totp(uri))).status).toBe(200);
    const challenge = await h.challenge();
    await error(
      await h.verify(challenge, totp(uri), true),
      400,
      "TRUSTED_DEVICE_DISABLED",
    );
    expect((await resolved(challenge)).data).toBeNull();
    const verified = await h.verify(challenge, totp(uri));
    expect(verified.status).toBe(200);
    expect(verified.headers.getSetCookie().length).toBeGreaterThan(1);
    expect(challenge.header.includes("trust_device")).toBe(false);
    expect((await h.request("/sign-out", challenge, {})).status).toBe(200);
    expect((await resolved(challenge)).data).toBeNull();
    await h.challenge();
  });

  it("does not expose backup, OTP or server-only helper endpoints over HTTP", async () => {
    const { jar } = await h.enabled();
    for (const path of [
      "/two-factor/generate-backup-codes",
      "/two-factor/verify-backup-code",
      "/two-factor/send-otp",
      "/two-factor/verify-otp",
      "/two-factor/view-backup-codes",
      "/totp/generate",
    ]) {
      expect(
        (
          await h.request(path, jar, {
            password,
            code: "unused",
            trustDevice: true,
          })
        ).status,
      ).toBe(404);
    }
    expect(Object.keys(h.foundationAuth()).sort()).toEqual([
      "handler",
      "resolveSession",
    ]);
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(true);
  });

  it("keeps Magic Link and Google as alternatives and preserves password change/reset/logout policies", async () => {
    const { jar, uri } = await h.enabled();
    const before = await resolved(jar);
    const magic = await h.magic();
    const google = await h.google();
    expect((await resolved(magic)).data?.user.id === before.data?.user.id).toBe(
      true,
    );
    expect(
      (await resolved(google)).data?.user.id === before.data?.user.id,
    ).toBe(true);
    const changed = await h.request("/change-password", jar, {
      currentPassword: password,
      newPassword: replacementPassword,
      revokeOtherSessions: true,
    });
    expect(changed.status).toBe(200);
    expect((await resolved(magic)).data).toBeNull();
    expect((await resolved(google)).data).toBeNull();
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(true);
    await h.challenge(replacementPassword);
    expect((await h.reset()).status).toBe(200);
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(true);
    const challenge = await h.challenge(replacementPassword);
    expect((await h.verify(challenge, totp(uri))).status).toBe(200);
    expect((await h.request("/sign-out", challenge, {})).status).toBe(200);
    expect((await resolved(challenge)).data).toBeNull();
  });

  it("requires password and correct origin for management, keeping other sessions after native disable", async () => {
    const { jar } = await h.enabled();
    const other = await h.magic();
    await error(
      await h.request("/two-factor/disable", jar, { password: "wrong" }),
      400,
      "INVALID_PASSWORD",
    );
    expect(
      (
        await h.request(
          "/two-factor/disable",
          jar,
          { password },
          "https://attacker.example",
        )
      ).status,
    ).toBe(403);
    const old = jar.copy();
    expect(
      (await h.request("/two-factor/disable", jar, { password })).status,
    ).toBe(200);
    expect((await resolved(old)).data).toBeNull();
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(false);
    expect((await resolved(other)).data?.user.twoFactorEnabled).toBe(false);
    expect((await h.login()).status).toBe(200);
  });

  it("does not let a passwordless identity enroll without setting a password first", async () => {
    const jar = await h.magic(
      undefined,
      "passwordless-integration@example.com",
    );
    await error(
      await h.request("/two-factor/enable", jar, { method: "totp" }),
      400,
      "VALIDATION_ERROR",
    );
    await error(
      await h.request("/two-factor/enable", jar, { password, method: "totp" }),
      400,
      "INVALID_PASSWORD",
    );
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(false);
  });

  it("shares the database limiter across request instances, trusts only the Cloudflare IP and expires the window", async () => {
    const { jar } = await h.enabled();
    h.rate.enabled = true;
    const transport = h.transport!;
    let spoofedIp = 1;
    h.transport = (request) => {
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-for", `198.51.100.${spoofedIp++}`);
      return transport(new Request(request, { headers }));
    };
    for (let attempt = 0; attempt < 3; attempt++)
      await error(
        await h.request("/two-factor/disable", jar, { password: "wrong" }),
        400,
        "INVALID_PASSWORD",
      );
    const limited = await h.request("/two-factor/disable", jar, { password });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-retry-after")).toBe("10");
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(true);
    vi.setSystemTime(new Date(Date.now() + 11_000));
    expect(
      (await h.request("/two-factor/disable", jar, { password })).status,
    ).toBe(200);
  });

  it("atomically limits concurrent D1 requests without losing increments", async () => {
    const { jar } = await h.enabled();
    h.rate.enabled = true;
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        h.request("/two-factor/disable", jar.copy(), { password: "wrong" }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 400),
    ).toHaveLength(3);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(3);
    expect(h.throws).toBe(0);
  });

  it("preserves durable account lockout across challenges and instances, with Magic Link as recovery", async () => {
    const { uri } = await h.enabled();
    for (let attempt = 0; attempt < 10; attempt++) {
      const challenge = await h.challenge();
      await error(await h.verify(challenge, "invalid"), 401, "INVALID_CODE");
    }
    const blocked = await h.challenge();
    await error(
      await h.verify(blocked, totp(uri)),
      429,
      "ACCOUNT_TEMPORARILY_LOCKED",
    );
    expect((await resolved(blocked)).data).toBeNull();
    expect((await resolved(await h.magic())).data?.user.twoFactorEnabled).toBe(
      true,
    );
    vi.setSystemTime(new Date(Date.now() + 901_000));
    const challenge = await h.challenge();
    expect((await h.verify(challenge, totp(uri))).status).toBe(200);
  });

  it("consumes a password challenge once even with concurrent public verification", async () => {
    const { uri } = await h.enabled();
    const challenge = await h.challenge();
    const other = challenge.copy();
    const results = await Promise.all([
      h.verify(challenge, totp(uri)),
      h.verify(other, totp(uri)),
    ]);
    expect(results.filter((response) => response.status === 200)).toHaveLength(
      1,
    );
    expect(results.filter((response) => response.status === 401)).toHaveLength(
      1,
    );
  });

  it("fails closed with an indeterminate response when database rate limiting is unavailable", async () => {
    const { jar } = await h.enabled();
    h.rate.enabled = true;
    h.binding = faultD1Queries(h.database.binding, (sql) =>
      sql.includes('"rate_limit"'),
    );
    const response = await h.request("/two-factor/disable", jar, { password });
    await error(response, 500, "AUTH_STATE_INDETERMINATE");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    h.binding = h.database.binding;
    expect((await resolved(jar)).data?.user.twoFactorEnabled).toBe(true);
  });

  it("reports a consumed challenge as indeterminate if replacement session creation fails, requiring a new login", async () => {
    const { uri } = await h.enabled();
    const challenge = await h.challenge();
    h.binding = faultD1Queries(h.database.binding, (sql) =>
      sql.startsWith('insert into "session"'),
    );
    const response = await h.verify(challenge, totp(uri));
    await error(response, 500, "AUTH_STATE_INDETERMINATE");
    expect(response.headers.getSetCookie()).toEqual([]);
    h.binding = h.database.binding;
    expect((await resolved(challenge)).data).toBeNull();
    await error(
      await h.verify(challenge, totp(uri)),
      401,
      "INVALID_TWO_FACTOR_COOKIE",
    );
    expect((await h.verify(await h.challenge(), totp(uri))).status).toBe(200);
  });

  it("does not forward login credentials or claim authentication if revocation before a password challenge fails", async () => {
    await h.enabled();
    h.binding = faultD1Queries(h.database.binding, (sql) =>
      sql.startsWith('delete from "session"'),
    );
    const response = await h.login();
    await error(response, 500, "AUTH_STATE_INDETERMINATE");
    expect(response.headers.getSetCookie()).toEqual([]);
    h.binding = h.database.binding;
    expect((await resolved(await h.magic())).data?.user.twoFactorEnabled).toBe(
      true,
    );
  });

  for (const failure of [
    "confirm-create",
    "confirm-verified",
    "confirm-revoke",
    "disable-delete",
    "disable-create",
    "disable-revoke",
  ] as const) {
    it(`does not claim success or rollback after partial ${failure}; public state and alternatives remain authoritative`, async () => {
      const jar = await h.signup();
      const uri = await h.enroll(jar);
      const disabling = failure.startsWith("disable");
      if (disabling) expect((await h.verify(jar, totp(uri))).status).toBe(200);
      const captures = [
        vi.spyOn(console, "error"),
        vi.spyOn(console, "warn"),
        vi.spyOn(console, "info"),
        vi.spyOn(console, "log"),
      ];
      for (const capture of captures)
        capture.mockImplementation(() => undefined);
      h.binding = faultD1Queries(h.database.binding, (sql) =>
        failure.endsWith("create")
          ? sql.startsWith('insert into "session"')
          : failure.endsWith("revoke")
            ? sql.startsWith('delete from "session"')
            : failure === "confirm-verified"
              ? sql.startsWith('update "two_factor"') &&
                sql.includes('"verified"')
              : sql.startsWith('delete from "two_factor"'),
      );
      const response = disabling
        ? await h.request("/two-factor/disable", jar, { password })
        : await h.verify(jar, totp(uri));
      await error(response, 500, "AUTH_STATE_INDETERMINATE");
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(h.throws).toBe(0); // Foundation handler owns sanitization, not harness transport.
      h.binding = h.database.binding;
      const alternative = await h.magic();
      expect((await resolved(alternative)).data?.user.twoFactorEnabled).toBe(
        !disabling,
      );
      if (!disabling) {
        const login = await h.login();
        expect(
          z
            .object({
              twoFactorRedirect: z.boolean(),
              twoFactorMethods: z.array(z.string()),
            })
            .parse(await login.json()).twoFactorMethods,
        ).toEqual([]);
        expect((await h.verify(alternative, totp(uri))).status).toBe(200);
      }
      const logs = JSON.stringify(
        captures.flatMap((capture) => capture.mock.calls),
      );
      for (const sensitive of [password, uri, totp(uri), jar.header])
        expect(logs.includes(sensitive)).toBe(false);
      expect(logs).toContain("auth.endpoint_failed");
    });
  }
});
