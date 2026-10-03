import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { faultD1Queries } from "../d1.js";
import {
  backupPaths,
  CookieJar,
  createTotpHarness,
  invalidCode,
  password,
  replacementPassword,
  totp,
} from "../totp-harness.js";

describe("Better Auth 1.7.7 TOTP characterization on disposable D1", () => {
  let h: Awaited<ReturnType<typeof createTotpHarness>>;
  beforeEach(async () => {
    // Fake Date only: real I/O/timers still drive Miniflare. No row time edits.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T12:00:05Z"));
    h = await createTotpHarness();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await h?.database.miniflare.dispose();
  });
  function advance(seconds: number) {
    vi.setSystemTime(new Date(Date.now() + seconds * 1000));
  }
  async function error(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(
      z.object({ code: z.string() }).parse(await response.json()).code,
    ).toBe(code);
  }
  async function enabledState(jar: CookieJar, expected: boolean) {
    const identity = await h.identity(jar);
    expect(identity !== null).toBe(true);
    expect(identity?.user.twoFactorEnabled).toBe(expected);
    return identity!;
  }
  async function disable(jar: CookieJar, currentPassword = password) {
    return h.request("/two-factor/disable", jar, { password: currentPassword });
  }

  it("keeps enrollment pending across requests, rejects bad password/code and cannot authenticate with its unconfirmed secret", async () => {
    const jar = await h.signup();
    const before = await enabledState(jar, false);
    await error(
      await h.request("/two-factor/enable", jar, {
        password: "wrong",
        method: "totp",
      }),
      400,
      "INVALID_PASSWORD",
    );
    const uri = await h.enroll(jar);
    expect(
      (await enabledState(jar, false)).session.id === before.session.id,
    ).toBe(true);
    await error(await h.verify(jar, invalidCode), 401, "INVALID_CODE");
    const unauthenticated = new CookieJar();
    await error(
      await h.verify(unauthenticated, totp(uri)),
      401,
      "INVALID_TWO_FACTOR_COOKIE",
    );
    expect(await h.identity(unauthenticated)).toBeNull();
    // Password still logs in normally: pending enrollment is not enabled MFA.
    const other = new CookieJar();
    expect((await h.login(other)).status).toBe(200);
    await enabledState(other, false);
    expect((await h.verify(jar, totp(uri))).status).toBe(200);
    await enabledState(jar, true);
  });

  it("replaces abandoned pending enrollment, exposes URI only with the correct password and rejects reenrollment once confirmed", async () => {
    const jar = await h.signup();
    const first = await h.enroll(jar);
    const second = await h.enroll(jar);
    expect(first === second).toBe(false);
    await error(
      await h.request("/two-factor/get-totp-uri", jar, { password: "wrong" }),
      400,
      "INVALID_PASSWORD",
    );
    const recovered = await h.request("/two-factor/get-totp-uri", jar, {
      password,
    });
    expect(recovered.status).toBe(200);
    const uri = z
      .object({ totpURI: z.string() })
      .parse(await recovered.json()).totpURI;
    expect(
      new URL(uri).searchParams.get("secret") ===
        new URL(second).searchParams.get("secret"),
    ).toBe(true);
    // 1.7.7 does not pass the top-level issuer to getTOTPURI's provider.
    expect(new URL(second).searchParams.get("issuer")).toBe("Links");
    expect(new URL(uri).searchParams.get("issuer")).toBe("Better Auth");
    expect((await h.verify(jar, totp(second))).status).toBe(200);
    await error(
      await h.request("/two-factor/enable", jar, { password, method: "totp" }),
      400,
      "TOTP_ALREADY_ENABLED",
    );
  });

  it("rotates the confirming browser, retains other sessions and returns the old token in the confirmation body", async () => {
    const jar = await h.signup();
    const before = await h.identity(jar);
    const old = jar.copy();
    const other = new CookieJar();
    expect((await h.login(other)).status).toBe(200);
    const otherBefore = await h.identity(other);
    const uri = await h.enroll(jar);
    // The public session response supplies this value; never read the session table.
    const sessionResponse = await h.request(
      "/get-session?disableRefresh=true",
      old,
    );
    const token = z
      .object({ session: z.object({ token: z.string() }) })
      .parse(await sessionResponse.json()).session.token;
    const confirmed = await h.verify(jar, totp(uri));
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers.getSetCookie().length).toBeGreaterThan(0);
    const data = z
      .object({
        token: z.string(),
        user: z.object({ twoFactorEnabled: z.boolean() }),
      })
      .parse(await confirmed.json());
    expect(data.token === token).toBe(true);
    // Returned user is the pre-update snapshot; trust cookie + authoritative getSession.
    expect(data.user.twoFactorEnabled).toBe(false);
    expect(await h.identity(old)).toBeNull();
    const after = await enabledState(jar, true);
    expect(after.session.id === before?.session.id).toBe(false);
    expect(after.user.id === before?.user.id).toBe(true);
    expect(
      (await enabledState(other, true)).session.id === otherBefore?.session.id,
    ).toBe(true);
  });

  it("withholds a session during password challenge, consumes it once and accepts TOTP again on another challenge", async () => {
    const { uri } = await h.enabled();
    const jar = await h.challenge();
    const replay = jar.copy();
    await error(await h.verify(jar, invalidCode), 401, "INVALID_CODE");
    expect(await h.identity(jar)).toBeNull();
    const confirmed = await h.verify(jar, totp(uri));
    expect(confirmed.status).toBe(200);
    await enabledState(jar, true);
    await error(
      await h.verify(replay, totp(uri)),
      401,
      "INVALID_TWO_FACTOR_COOKIE",
    );
    const second = await h.challenge();
    expect((await h.verify(second, totp(uri))).status).toBe(200);
    await enabledState(second, true);
  });

  it("expires a challenge after ten minutes and rejects a cookie-free attempt", async () => {
    const { uri } = await h.enabled();
    const jar = await h.challenge();
    advance(601);
    await error(
      await h.verify(jar, totp(uri)),
      401,
      "INVALID_TWO_FACTOR_COOKIE",
    );
    expect(await h.identity(jar)).toBeNull();
    await error(
      await h.verify(new CookieJar(), totp(uri)),
      401,
      "INVALID_TWO_FACTOR_COOKIE",
    );
  });

  it("allows only one concurrent successful use of the same challenge", async () => {
    const { uri } = await h.enabled();
    const challenge = await h.challenge();
    const jars = [challenge.copy(), challenge.copy()];
    const responses = await Promise.all(
      jars.map((jar) => h.verify(jar, totp(uri))),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    const identities = await Promise.all(jars.map((jar) => h.identity(jar)));
    expect(identities.filter(Boolean).length).toBe(1);
  });

  it("prioritizes an existing authenticated identity over another account's challenge", async () => {
    const { uri } = await h.enabled();
    const challenge = await h.challenge();
    const other = await h.signup("other-totp-reader@example.com");
    const otherId = (await h.identity(other))!.user.id;
    other.includeChallenge(challenge);
    await error(await h.verify(other, totp(uri)), 400, "TOTP_NOT_ENABLED");
    expect((await h.identity(other))?.user.id).toBe(otherId);
    // The unrelated account's challenge was not consumed.
    expect((await h.verify(challenge, totp(uri))).status).toBe(200);
  });

  it("accepts the adjacent thirty-second windows and preserves a leading zero", async () => {
    const { jar, uri } = await h.enabled();
    for (const offset of [-2, -1, 0, 1, 2]) {
      expect((await h.verify(jar, totp(uri, offset))).status).toBe(
        Math.abs(offset) <= 1 ? 200 : 401,
      );
    }
    // Find a leading-zero period without replacing persisted secrets.
    let periods = 0;
    while (!totp(uri).startsWith("0") && periods < 1000) {
      advance(30);
      periods++;
    }
    expect(totp(uri).length).toBe(6);
    expect(totp(uri).startsWith("0")).toBe(true);
    expect((await h.verify(jar, totp(uri))).status).toBe(200);
  });

  it.each(["magic", "google"] as const)(
    "keeps %s as an alternative login without TOTP for an enabled account",
    async (provider) => {
      const { jar } = await h.enabled();
      const before = await h.identity(jar);
      const alternative = await h[provider]();
      const after = await enabledState(alternative, true);
      expect(after.user.id === before?.user.id).toBe(true);
      expect(after.session.id === before?.session.id).toBe(false);
      await h.challenge();
    },
  );

  it.each(["magic", "google"] as const)(
    "requires a first password for a %s-only identity, then preserves identity through reset/enrollment",
    async (provider) => {
      const jar = await h[provider]();
      const before = await enabledState(jar, false);
      await error(
        await h.request("/two-factor/enable", jar, {
          password,
          method: "totp",
        }),
        400,
        "INVALID_PASSWORD",
      );
      expect((await h.reset()).status).toBe(200);
      expect((await h.identity(jar))?.user.id === before.user.id).toBe(true);
      const response = await h.request("/two-factor/enable", jar, {
        password: replacementPassword,
        method: "totp",
      });
      expect(response.status).toBe(200);
      const uri = z
        .object({ totpURI: z.string() })
        .parse(await response.json()).totpURI;
      expect((await h.verify(jar, totp(uri))).status).toBe(200);
      const challenge = await h.challenge(replacementPassword);
      expect((await h.verify(challenge, totp(uri))).status).toBe(200);
      expect((await h.identity(challenge))?.user.id === before.user.id).toBe(
        true,
      );
    },
  );

  it("requires the actual password even when allowPasswordless is enabled on a credential account", async () => {
    h.allowPasswordless = true;
    const jar = await h.signup();
    await error(
      await h.request("/two-factor/enable", jar, { method: "totp" }),
      400,
      "INVALID_PASSWORD",
    );
    const passwordless = await h.magic(undefined, "passwordless@example.com");
    const response = await h.request("/two-factor/enable", passwordless, {
      method: "totp",
    });
    expect(response.status).toBe(200);
    const uri = z
      .object({ totpURI: z.string() })
      .parse(await response.json()).totpURI;
    expect((await h.verify(passwordless, totp(uri))).status).toBe(200);
    expect(
      (await h.request("/two-factor/disable", passwordless, {})).status,
    ).toBe(200);
  });

  it("disables using password alone on an old session, rotates it, retains other sessions and removes the secret", async () => {
    const { jar, uri } = await h.enabled();
    const old = jar.copy();
    const before = await h.identity(jar);
    const other = await h.magic();
    const otherBefore = await h.identity(other);
    advance(86_400);
    await error(await disable(jar, "wrong"), 400, "INVALID_PASSWORD");
    await error(
      await h.request("/two-factor/disable", jar, {}),
      400,
      "VALIDATION_ERROR",
    );
    const response = await disable(jar);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(await h.identity(old)).toBeNull();
    expect(
      (await enabledState(jar, false)).session.id === before?.session.id,
    ).toBe(false);
    expect(
      (await enabledState(other, false)).session.id === otherBefore?.session.id,
    ).toBe(true);
    await error(await h.verify(jar, totp(uri)), 400, "TOTP_NOT_ENABLED");
    const login = new CookieJar();
    expect((await h.login(login)).status).toBe(200);
    await enabledState(login, false);
  });

  it("does not refresh session creation time when verifying TOTP in an authenticated session", async () => {
    const { jar, uri } = await h.enabled();
    const before = await h.identity(jar);
    advance(7200);
    expect((await h.verify(jar, totp(uri))).status).toBe(200);
    const after = await h.identity(jar);
    expect(after?.session.id === before?.session.id).toBe(true);
    expect(
      after?.session.createdAt.getTime() ===
        before?.session.createdAt.getTime(),
    ).toBe(true);
  });

  it("uses an empty public backup generator, blocks both HTTP endpoints and rejects backup verification even via the public server API", async () => {
    const { jar } = await h.enabled();
    for (const path of backupPaths) {
      expect(
        (await h.request(path, jar, { password, code: "unused-code" })).status,
      ).toBe(404);
    }
    // disabledPaths is an HTTP boundary, not a prohibition on server API calls.
    await expect(
      h.auth().api.verifyBackupCode({
        headers: new Headers({ cookie: jar.header }),
        body: { code: "unused-code" },
      }),
    ).rejects.toMatchObject({ body: { code: "INVALID_BACKUP_CODE" } });
    expect((await disable(jar)).status).toBe(200);
  });

  it("generates ten default recovery codes when the empty generator is omitted", async () => {
    h.emptyBackupCodes = false;
    const jar = await h.signup();
    await h.enroll(jar); // Enrollment helper asserts default count, not values.
  });

  it("does not configure OTP, but trusted devices remain available unless explicitly guarded", async () => {
    const { uri } = await h.enabled();
    const challenge = await h.challenge();
    await error(
      await h.request("/two-factor/send-otp", challenge, {}),
      400,
      "OTP_NOT_CONFIGURED",
    );
    const confirmed = await h.verify(challenge, totp(uri), true);
    expect(confirmed.status).toBe(200);
    expect(
      confirmed.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("better-auth.trust_device=")),
    ).toBe(true);
    expect((await h.request("/sign-out", challenge, {})).status).toBe(200);
    expect((await h.login(challenge)).status).toBe(200);
    await enabledState(challenge, true); // Trusted device bypasses password challenge.
  });

  it("caps a single challenge at five wrong codes before a sixth request invalidates it", async () => {
    const { uri } = await h.enabled();
    const challenge = await h.challenge();
    for (let attempt = 0; attempt < 5; attempt++) {
      await error(await h.verify(challenge, invalidCode), 401, "INVALID_CODE");
    }
    await error(
      await h.verify(challenge, totp(uri)),
      400,
      "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
    );
    await error(
      await h.verify(challenge, totp(uri)),
      401,
      "INVALID_TWO_FACTOR_COOKIE",
    );
    const fresh = await h.challenge();
    expect((await h.verify(fresh, totp(uri))).status).toBe(200);
  });

  it("persists account lockout across challenges/auth instances in D1 and expires after fifteen minutes", async () => {
    const { uri } = await h.enabled();
    for (let challenge = 0; challenge < 2; challenge++) {
      const jar = await h.challenge();
      for (let attempt = 0; attempt < 5; attempt++) {
        await error(await h.verify(jar, invalidCode), 401, "INVALID_CODE");
      }
    }
    const locked = await h.challenge();
    await error(
      await h.verify(locked, totp(uri)),
      429,
      "ACCOUNT_TEMPORARILY_LOCKED",
    );
    expect(await h.identity(locked)).toBeNull();
    const magic = await h.magic();
    await enabledState(magic, true); // Lockout does not block approved alternatives.
    advance(901);
    const unlocked = await h.challenge();
    expect((await h.verify(unlocked, totp(uri))).status).toBe(200);
  });

  it("resets account failure count after successful login but does not lock authenticated verification", async () => {
    const { jar, uri } = await h.enabled();
    for (let attempt = 0; attempt < 11; attempt++) {
      await error(await h.verify(jar, invalidCode), 401, "INVALID_CODE");
    }
    for (let cycle = 0; cycle < 3; cycle++) {
      const challenge = await h.challenge();
      for (let attempt = 0; attempt < 4; attempt++) {
        await error(
          await h.verify(challenge, invalidCode),
          401,
          "INVALID_CODE",
        );
      }
      expect((await h.verify(challenge, totp(uri))).status).toBe(200);
    }
  });

  it("counts concurrent failures across independent challenges toward the same D1 account lock", async () => {
    const { uri } = await h.enabled();
    const challenges = await Promise.all(
      Array.from({ length: 10 }, () => h.challenge()),
    );
    const responses = await Promise.all(
      challenges.map((jar) => h.verify(jar, invalidCode)),
    );
    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: 10 }, () => 401),
    );
    await error(
      await h.verify(await h.challenge(), totp(uri)),
      429,
      "ACCOUNT_TEMPORARILY_LOCKED",
    );
  });

  it("enforces the plugin's three-per-ten-seconds HTTP rule with database storage across instances and recovers after the window", async () => {
    const { jar } = await h.enabled();
    h.rate = { enabled: true, storage: "database" };
    for (let request = 0; request < 3; request++) {
      await error(await disable(jar, "wrong"), 400, "INVALID_PASSWORD");
    }
    const limited = await disable(jar, "wrong");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("x-retry-after"))).toBe(10);
    advance(11);
    await error(await disable(jar, "wrong"), 400, "INVALID_PASSWORD");
  });

  it("caps concurrent database-backed rate-limit requests without losing increments", async () => {
    const { jar } = await h.enabled();
    h.rate = { enabled: true, storage: "database" };
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => disable(jar.copy(), "wrong")),
    );
    expect(responses.filter((response) => response.status === 400).length).toBe(
      3,
    );
    expect(responses.filter((response) => response.status === 429).length).toBe(
      3,
    );
    expect(h.throws).toBe(0);
  });

  it("uses memory by default for enabled rate limiting, shared between instances without consulting D1 storage", async () => {
    const { jar } = await h.enabled();
    h.rate = { enabled: true };
    let storageCalls = 0;
    h.binding = faultD1Queries(h.database.binding, (sql) => {
      if (sql.includes('"rate_limit"')) {
        storageCalls++;
        return true;
      }
      return false;
    });
    for (let request = 0; request < 3; request++) {
      await error(await disable(jar, "wrong"), 400, "INVALID_PASSWORD");
    }
    expect((await disable(jar, "wrong")).status).toBe(429);
    expect(storageCalls).toBe(0);
    expect(h.throws).toBe(0);
  });

  it("fails closed when database rate-limit storage is unavailable", async () => {
    const { jar } = await h.enabled();
    h.rate = { enabled: true, storage: "database" };
    let failures = 0;
    h.binding = faultD1Queries(h.database.binding, (sql) => {
      if (sql.includes('"rate_limit"')) {
        failures++;
        return true;
      }
      return false;
    });
    expect((await disable(jar)).status).toBe(500);
    expect(failures).toBe(1);
    h.binding = h.database.binding;
    await enabledState(jar, true);
  });

  it("does not authenticate when persisting an account failure counter fails, and allows retry after D1 recovery", async () => {
    const { uri } = await h.enabled();
    const challenge = await h.challenge();
    let failures = 0;
    h.binding = faultD1Queries(h.database.binding, (sql) => {
      if (/^update\s+"two_factor"/i.test(sql)) {
        failures++;
        return true;
      }
      return false;
    });
    expect((await h.verify(challenge, invalidCode)).status).toBe(500);
    expect(failures).toBe(1);
    h.binding = h.database.binding;
    expect(await h.identity(challenge)).toBeNull();
    expect((await h.verify(challenge, totp(uri))).status).toBe(200);
  });

  it.each(["change", "reset"] as const)(
    "preserves TOTP after password %s with the existing session policy",
    async (operation) => {
      const { jar, uri } = await h.enabled();
      const old = jar.copy();
      const other = await h.magic();
      const response =
        operation === "change"
          ? await h.request("/change-password", jar, {
              currentPassword: password,
              newPassword: replacementPassword,
              revokeOtherSessions: true,
            })
          : await h.reset();
      expect(response.status).toBe(200);
      if (operation === "change") {
        expect(await h.identity(old)).toBeNull();
        expect(await h.identity(other)).toBeNull();
      } else {
        await enabledState(old, true);
        await enabledState(other, true);
        expect(response.headers.getSetCookie().length).toBe(0);
      }
      await enabledState(jar, true);
      expect((await h.login(new CookieJar())).status).toBe(401);
      const challenge = await h.challenge(replacementPassword);
      expect((await h.verify(challenge, totp(uri))).status).toBe(200);
      await enabledState(challenge, true);
    },
  );

  it("rejects cross-origin enrollment, verification and disable without changing state", async () => {
    const { jar } = await h.enabled();
    for (const path of ["enable", "verify-totp", "disable"]) {
      expect(
        (
          await h.request(
            `/two-factor/${path}`,
            jar,
            { password, code: invalidCode },
            "https://attacker.example",
          )
        ).status,
      ).toBe(403);
    }
    await enabledState(jar, true);
  });

  it("recovers from a lost confirmation response through the approved Magic Link alternative", async () => {
    const jar = await h.signup();
    const uri = await h.enroll(jar);
    const transportJar = jar.copy();
    // Mutation commits but original browser never receives Set-Cookie.
    expect((await h.verify(transportJar, totp(uri))).status).toBe(200);
    expect(await h.identity(jar)).toBeNull();
    await enabledState(await h.magic(), true);
    const challenge = await h.challenge();
    expect((await h.verify(challenge, totp(uri))).status).toBe(200);
  });

  it.each(["confirm", "disable"] as const)(
    "throws after creating a replacement when old-session revocation fails during %s",
    async (operation) => {
      const jar = await h.signup();
      const uri = await h.enroll(jar);
      if (operation === "disable")
        expect((await h.verify(jar, totp(uri))).status).toBe(200);
      const old = jar.copy();
      let failures = 0;
      h.binding = faultD1Queries(h.database.binding, (sql) => {
        if (/^delete\s+from\s+"session"/i.test(sql)) {
          failures++;
          return true;
        }
        return false;
      });
      const response =
        operation === "confirm"
          ? await h.verify(jar, totp(uri))
          : await disable(jar);
      expect(response.status).toBe(500);
      expect(failures).toBe(1);
      expect(h.throws).toBe(1);
      expect(response.headers.getSetCookie().length).toBe(0);
      h.binding = h.database.binding;
      await enabledState(old, operation === "confirm");
      const sessions = await h.request("/list-sessions", old);
      expect(sessions.status).toBe(200);
      expect(
        z.array(z.object({ id: z.string() })).parse(await sessions.json())
          .length,
      ).toBe(2);
      const recovered = await h.magic();
      if (operation === "confirm")
        expect((await h.verify(recovered, totp(uri))).status).toBe(200);
      else expect((await disable(recovered)).status).toBe(200);
    },
  );

  it("consumes a valid challenge before session creation, so a partial creation failure requires a new password login", async () => {
    const { uri } = await h.enabled();
    const challenge = await h.challenge();
    let failures = 0;
    h.binding = faultD1Queries(h.database.binding, (sql) => {
      if (/^insert\s+into\s+"session"/i.test(sql)) {
        failures++;
        return true;
      }
      return false;
    });
    expect((await h.verify(challenge, totp(uri))).status).toBe(500);
    expect(failures).toBe(1);
    h.binding = h.database.binding;
    expect(await h.identity(challenge)).toBeNull();
    await error(
      await h.verify(challenge, totp(uri)),
      401,
      "INVALID_TWO_FACTOR_COOKIE",
    );
    expect((await h.verify(await h.challenge(), totp(uri))).status).toBe(200);
  });

  it("throws without issuing cookies or a challenge when password-login revocation fails, but leaves a durable orphan session", async () => {
    const { jar } = await h.enabled();
    let failures = 0;
    h.binding = faultD1Queries(h.database.binding, (sql) => {
      if (/^delete\s+from\s+"session"/i.test(sql)) {
        failures++;
        return true;
      }
      return false;
    });
    const browser = new CookieJar();
    const response = await h.login(browser);
    expect(response.status).toBe(500);
    expect(response.headers.getSetCookie().length).toBe(0);
    expect(failures).toBe(1);
    h.binding = h.database.binding;
    expect(await h.identity(browser)).toBeNull();
    const sessions = await h.request("/list-sessions", jar);
    expect(sessions.status).toBe(200);
    expect(
      z.array(z.object({ id: z.string() })).parse(await sessions.json()).length,
    ).toBe(2);
  });

  it.each([
    "confirm-create",
    "confirm-verified",
    "disable-delete",
    "disable-create",
  ] as const)(
    "characterizes committed partial effects when %s fails on real D1",
    async (stage) => {
      const confirming = stage.startsWith("confirm");
      const jar = await h.signup();
      const uri = await h.enroll(jar);
      if (!confirming)
        expect((await h.verify(jar, totp(uri))).status).toBe(200);
      const old = jar.copy();
      let failures = 0;
      h.binding = faultD1Queries(h.database.binding, (sql) => {
        const matches = stage.endsWith("create")
          ? /^insert\s+into\s+"session"/i.test(sql)
          : stage === "confirm-verified"
            ? /^update\s+"two_factor"/i.test(sql)
            : /^delete\s+from\s+"two_factor"/i.test(sql);
        if (matches) failures++;
        return matches;
      });
      const failed = confirming
        ? await h.verify(jar, totp(uri))
        : await disable(jar);
      expect(failed.status).toBe(500);
      expect(failures).toBe(1);
      expect(h.throws).toBe(1);
      h.binding = h.database.binding;
      if (stage === "confirm-verified")
        expect(await h.identity(old)).toBeNull();
      else await enabledState(old, confirming);
      const recovered = await h.magic();
      await enabledState(recovered, confirming);
      if (confirming) {
        // Enabled user + unverified row cannot use its secret to finish login.
        const challenge = new CookieJar();
        const login = await h.login(challenge);
        expect(login.status).toBe(200);
        expect(await login.json()).toEqual({
          twoFactorRedirect: true,
          twoFactorMethods: [],
        });
        await error(
          await h.verify(challenge, totp(uri)),
          400,
          "TOTP_NOT_ENABLED",
        );
        expect(await h.identity(challenge)).toBeNull();
        expect((await h.verify(recovered, totp(uri))).status).toBe(200);
        const retry = await h.challenge();
        expect((await h.verify(retry, totp(uri))).status).toBe(200);
      } else {
        // Disable already changed the user flag even though its HTTP result failed.
        const login = new CookieJar();
        expect((await h.login(login)).status).toBe(200);
        await enabledState(login, false);
        expect((await disable(recovered)).status).toBe(200);
      }
    },
  );
});
