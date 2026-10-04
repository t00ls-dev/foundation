import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, twoFactor } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { expect, vi } from "vitest";
import { z } from "zod";
import { account, session, verification } from "../src/schema.js";
import { applyMigrations, createTestDatabase } from "./d1.js";

// Test-owned superset only. Production schema/migrations and auth stay unchanged.
const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(
    false,
  ),
});
const twoFactorTable = sqliteTable("two_factor", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: integer("verified", { mode: "boolean" }).default(true),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
});
const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});
const schema = {
  user,
  account,
  session,
  verification,
  twoFactor: twoFactorTable,
  rateLimit,
};
let nextIp = 1;

export const origin = "http://localhost:3000";
export const password = "characterization-password-original";
export const replacementPassword = "characterization-password-replacement";
export const email = "totp-characterization@example.com";
export const invalidCode = "not-a-totp";
export const backupPaths = [
  "/two-factor/generate-backup-codes",
  "/two-factor/verify-backup-code",
];
const identitySchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean(),
  }),
  session: z.object({ id: z.string(), createdAt: z.coerce.date() }),
});
export type Identity = z.infer<typeof identitySchema>;

// Apply every cookie, including deletion, in response order. Assertions compare
// booleans rather than printing secrets/cookies on failed equality checks.
export class CookieJar {
  private values = new Map<string, string>();
  apply(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!;
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      if (/max-age=0/i.test(cookie)) this.values.delete(name);
      else this.values.set(name, pair.slice(index + 1));
    }
  }
  get header() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  copy() {
    const jar = new CookieJar();
    jar.values = new Map(this.values);
    return jar;
  }
  onlyChallenge() {
    const jar = new CookieJar();
    jar.values = new Map(
      [...this.values].filter(([name]) => name.endsWith(".two_factor")),
    );
    return jar;
  }
  includeChallenge(other: CookieJar) {
    for (const [name, value] of other.onlyChallenge().values) {
      this.values.set(name, value);
    }
  }
}

// Independent RFC 6238 reference, using only the public enrollment URI.
export function totp(uri: string, offset = 0) {
  const params = new URL(uri).searchParams;
  const encoded = params.get("secret")!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...encoded.replaceAll("=", "")]
    .map((char) =>
      alphabet.indexOf(char.toUpperCase()).toString(2).padStart(5, "0"),
    )
    .join("");
  const secret = Uint8Array.from(
    bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)),
  );
  const period = Number(params.get("period") ?? 30);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(
    0,
    BigInt(Math.floor(Date.now() / 1000 / period) + offset),
  );
  const hash = createHmac("sha1", secret).update(counter).digest();
  const position = hash[hash.length - 1]! & 15;
  const digits = Number(params.get("digits") ?? 6);
  return (
    (new DataView(hash.buffer, hash.byteOffset).getUint32(position) &
      0x7fffffff) %
    10 ** digits
  )
    .toString()
    .padStart(digits, "0");
}

function base64url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

export async function createTotpHarness(productionMigrations = false) {
  const database = await createTestDatabase();
  if (productionMigrations) await applyMigrations(database.binding);
  else {
    // Keep characterization independent from the production TOTP migration.
    await applyMigrations(database.binding, "0001_better_auth.sql");
    await applyMigrations(database.binding, "0002_links.sql");
    // DDL only: no fixture identities, sessions or plugin state inserted directly.
    await database.binding.batch([
      database.binding.prepare(
        "ALTER TABLE user ADD COLUMN two_factor_enabled INTEGER DEFAULT 0",
      ),
      database.binding.prepare(`CREATE TABLE two_factor (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id),
      secret TEXT NOT NULL, backup_codes TEXT NOT NULL, verified INTEGER DEFAULT 1,
      failed_verification_count INTEGER DEFAULT 0, locked_until INTEGER
    )`),
      database.binding.prepare(
        "CREATE INDEX two_factor_user_idx ON two_factor(user_id)",
      ),
      database.binding.prepare(
        "CREATE INDEX two_factor_secret_idx ON two_factor(secret)",
      ),
      database.binding.prepare(`CREATE TABLE rate_limit (
      id TEXT PRIMARY KEY NOT NULL, key TEXT NOT NULL UNIQUE,
      count INTEGER NOT NULL, last_request INTEGER NOT NULL
    )`),
    ]);
  }
  const sent: Array<{ subject: string; url: string }> = [];
  const harness = {
    database,
    binding: database.binding,
    rate: { enabled: false } as NonNullable<BetterAuthOptions["rateLimit"]>,
    blocked: [...backupPaths],
    emptyBackupCodes: true,
    allowPasswordless: false,
    ip: `192.0.2.${nextIp++}`,
    throws: 0,
    transport: undefined as
      ((request: Request) => Promise<Response>) | undefined,
    captureEmail(this: void, input: { subject: string; text: string }) {
      const subject = {
        "Verify your email": "verify",
        "Reset your password": "reset",
        "Sign in": "magic",
      }[input.subject];
      if (!subject) throw new Error("Unexpected Foundation email subject");
      sent.push({ subject, url: input.text });
      return Promise.resolve();
    },
    // New auth per request matches Links' lifetime; durable state remains in D1.
    auth() {
      return betterAuth({
        baseURL: origin,
        secret: "characterization-secret-at-least-thirty-two-characters",
        database: drizzleAdapter(drizzle(harness.binding), {
          provider: "sqlite",
          schema,
        }),
        advanced: {
          disableOriginCheck: false,
          ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
        },
        logger: { disabled: true },
        onAPIError: { throw: true },
        rateLimit: harness.rate,
        disabledPaths: harness.blocked,
        emailAndPassword: {
          enabled: true,
          requireEmailVerification: true,
          sendResetPassword: ({ url }) => {
            sent.push({ subject: "reset", url });
            return Promise.resolve();
          },
        },
        emailVerification: {
          sendVerificationEmail: ({ url }) => {
            sent.push({ subject: "verify", url });
            return Promise.resolve();
          },
        },
        socialProviders: {
          google: {
            clientId: "test-google-client",
            clientSecret: "test-google-secret",
          },
        },
        plugins: [
          magicLink({
            sendMagicLink: ({ url }) => {
              sent.push({ subject: "magic", url });
              return Promise.resolve();
            },
          }),
          twoFactor({
            issuer: "Links",
            allowPasswordless: harness.allowPasswordless,
            ...(harness.emptyBackupCodes
              ? { backupCodeOptions: { customBackupCodesGenerate: () => [] } }
              : {}),
          }),
        ],
      });
    },
    async request(
      path: string,
      jar = new CookieJar(),
      body?: unknown,
      requestOrigin = origin,
    ) {
      let response: Response;
      try {
        response = await (
          harness.transport ??
          ((request: Request) => harness.auth().handler(request))
        )(
          new Request(
            new URL(path.startsWith("/") ? `/api/auth${path}` : path, origin),
            {
              method: body === undefined ? "GET" : "POST",
              headers: {
                "Origin": requestOrigin,
                "Content-Type": "application/json",
                "Cookie": jar.header,
                "cf-connecting-ip": harness.ip,
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            },
          ),
        );
      } catch {
        // Test transport only, not the Foundation sanitization wrapper.
        harness.throws++;
        response = Response.json({ code: "HARNESS_THROW" }, { status: 500 });
      }
      jar.apply(response);
      return response;
    },
    async identity(jar: CookieJar): Promise<Identity | null> {
      const response = await harness.request(
        "/get-session?disableCookieCache=true&disableRefresh=true",
        jar,
      );
      expect(response.status).toBe(200);
      const data: unknown = await response.json();
      return data === null ? null : identitySchema.parse(data);
    },
    async login(
      jar = new CookieJar(),
      loginPassword = password,
      loginEmail = email,
    ) {
      return harness.request("/sign-in/email", jar, {
        email: loginEmail,
        password: loginPassword,
      });
    },
    delivered(subject: string) {
      const message = sent.findLast((value) => value.subject === subject);
      if (!message) throw new Error("Expected captured email");
      return message.url;
    },
    async signup(signupEmail = email) {
      expect(
        (
          await harness.request("/sign-up/email", undefined, {
            email: signupEmail,
            password,
            name: "TOTP Reader",
          })
        ).status,
      ).toBe(200);
      expect((await harness.request(harness.delivered("verify"))).status).toBe(
        302,
      );
      const jar = new CookieJar();
      expect((await harness.login(jar, password, signupEmail)).status).toBe(
        200,
      );
      return jar;
    },
    async enroll(jar: CookieJar) {
      const response = await harness.request("/two-factor/enable", jar, {
        password,
        method: "totp",
      });
      expect(response.status).toBe(200);
      const data = z
        .object({
          method: z.literal("totp"),
          totpURI: z.string(),
          backupCodes: z.array(z.string()),
        })
        .parse(await response.json());
      expect(data.backupCodes.length).toBe(harness.emptyBackupCodes ? 0 : 10);
      return data.totpURI;
    },
    async verify(jar: CookieJar, code: string, trustDevice = false) {
      return harness.request("/two-factor/verify-totp", jar, {
        code,
        trustDevice,
      });
    },
    async enabled() {
      const jar = await harness.signup();
      const uri = await harness.enroll(jar);
      expect((await harness.verify(jar, totp(uri))).status).toBe(200);
      expect((await harness.identity(jar))?.user.twoFactorEnabled).toBe(true);
      return { jar, uri };
    },
    async challenge(loginPassword = password) {
      const jar = new CookieJar();
      const response = await harness.login(jar, loginPassword);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        twoFactorRedirect: true,
        twoFactorMethods: ["totp"],
      });
      expect(await harness.identity(jar)).toBeNull();
      return jar;
    },
    async magic(jar = new CookieJar(), loginEmail = email) {
      expect(
        (
          await harness.request("/sign-in/magic-link", jar, {
            email: loginEmail,
            callbackURL: "/bookmarks",
          })
        ).status,
      ).toBe(200);
      expect(
        (await harness.request(harness.delivered("magic"), jar)).status,
      ).toBe(302);
      return jar;
    },
    async reset() {
      expect(
        (
          await harness.request("/request-password-reset", undefined, {
            email,
            redirectTo: "/reset-password",
          })
        ).status,
      ).toBe(200);
      const redirect = await harness.request(harness.delivered("reset"));
      expect(redirect.status).toBe(302);
      const token = new URL(
        redirect.headers.get("location")!,
        origin,
      ).searchParams.get("token");
      expect(Boolean(token)).toBe(true);
      return harness.request("/reset-password", undefined, {
        token,
        newPassword: replacementPassword,
      });
    },
    async google(loginEmail = email) {
      const jar = new CookieJar();
      const start = await harness.request("/sign-in/social", jar, {
        provider: "google",
        callbackURL: "/bookmarks",
        disableRedirect: true,
      });
      expect(start.status).toBe(200);
      const authorization = new URL(
        z.object({ url: z.string() }).parse(await start.json()).url,
      );
      const state = authorization.searchParams.get("state")!;
      expect(Boolean(authorization.searchParams.get("code_challenge"))).toBe(
        true,
      );
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const jwk = {
        ...publicKey.export({ format: "jwk" }),
        kid: "test-google-key",
        alg: "RS256",
        use: "sig",
      };
      const header = base64url(
        new TextEncoder().encode(
          JSON.stringify({ alg: "RS256", kid: jwk.kid }),
        ),
      );
      const payload = base64url(
        new TextEncoder().encode(
          JSON.stringify({
            iss: "https://accounts.google.com",
            aud: "test-google-client",
            sub: `google-subject-${loginEmail}`,
            email: loginEmail,
            email_verified: true,
            name: "Google Reader",
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            ...(authorization.searchParams.get("nonce")
              ? { nonce: authorization.searchParams.get("nonce") }
              : {}),
          }),
        ),
      );
      const unsigned = `${header}.${payload}`;
      const token = `${unsigned}.${base64url(sign("RSA-SHA256", new TextEncoder().encode(unsigned), privateKey))}`;
      let exchanges = 0;
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          if (url.href === "https://oauth2.googleapis.com/token") {
            exchanges++;
            return Promise.resolve(
              Response.json({
                access_token: "test-access-token",
                token_type: "Bearer",
                expires_in: 3600,
                id_token: token,
                scope: "openid email profile",
              }),
            );
          }
          if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
            return Promise.resolve(Response.json({ keys: [jwk] }));
          }
          throw new Error("Unexpected external request in OAuth fixture");
        });
      try {
        const callback = await harness.request(
          `/callback/google?code=test-code&state=${encodeURIComponent(state)}`,
          jar,
        );
        expect(callback.status).toBe(302);
        expect(
          new URL(callback.headers.get("location")!, origin).pathname,
        ).toBe("/bookmarks");
        expect(exchanges).toBe(1);
      } finally {
        fetch.mockRestore();
      }
      return jar;
    },
  };
  return harness;
}
