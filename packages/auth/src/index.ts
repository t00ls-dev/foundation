import { betterAuth, type Auth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink, twoFactor } from "better-auth/plugins";

export interface FoundationEmail {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

type BetterAuthDatabase = NonNullable<
  Parameters<typeof betterAuth>[0]
>["database"];

export interface FoundationAuthOptions {
  baseURL: string;
  database: BetterAuthDatabase;
  email: FoundationEmail;
  google?: { clientId: string; clientSecret: string };
  secret: string;
  /** TOTP for password login only; enrollment requires a separate explicit opt-in. */
  totp?: { issuer: string; enrollmentEnabled?: boolean };
  /** Requires the consumer's rateLimit schema. Enabled follows Better Auth's production default. */
  rateLimit?: {
    storage: "database";
    enabled?: boolean;
    ipAddressHeaders?: string[];
  };
}

export interface FoundationAuth {
  handler(request: Request): Promise<Response>;
  resolveSession(headers: Headers): Promise<{
    data: FoundationSession | null;
    headers: Headers;
  }>;
}

export type FoundationSession = Auth["$Infer"]["Session"] & {
  user: { twoFactorEnabled?: boolean };
};

const authLogEvents = new Map([
  ["INTERNAL_SERVER_ERROR", "auth.internal_error"],
  ["Failed to read session from database", "auth.session_read_failed"],
  ["Failed to delete session from database", "auth.session_revocation_failed"],
  ["AUTH_ENDPOINT_FAILED", "auth.endpoint_failed"],
]);

function logAuth(level: "debug" | "info" | "warn" | "error", message: string) {
  // Messages and extra arguments may contain SQL, credentials or URLs.
  // Only emit allowlisted event names, never upstream text/error objects.
  const record = JSON.stringify({
    component: "foundation.auth",
    level,
    event: authLogEvents.get(message) ?? "auth.event",
  });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.info(record);
}

export function createFoundationAuth(
  options: FoundationAuthOptions,
): FoundationAuth {
  const auth = betterAuth({
    baseURL: options.baseURL,
    // Better Auth intentionally accepts several unrelated database adapter shapes.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    database: options.database,
    secret: options.secret,
    // Better Auth otherwise skips origin checks automatically under NODE_ENV=test.
    // Keep the same protection in tests and deployed applications.
    advanced: {
      disableOriginCheck: false,
      ...(options.rateLimit?.ipAddressHeaders
        ? {
            ipAddress: { ipAddressHeaders: options.rateLimit.ipAddressHeaders },
          }
        : {}),
    },
    ...(options.rateLimit
      ? {
          rateLimit: {
            storage: options.rateLimit.storage,
            ...(options.rateLimit.enabled !== undefined
              ? { enabled: options.rateLimit.enabled }
              : {}),
          },
        }
      : {}),
    ...(options.totp
      ? {
          appName: options.totp.issuer,
          disabledPaths: [
            "/two-factor/generate-backup-codes",
            "/two-factor/verify-backup-code",
            "/two-factor/send-otp",
            "/two-factor/verify-otp",
            ...(!options.totp.enrollmentEnabled ? ["/two-factor/enable"] : []),
          ],
          hooks: {
            before: createAuthMiddleware((ctx) => {
              if (!ctx.path?.startsWith("/two-factor/"))
                return Promise.resolve();
              const body = ctx.body as Record<string, unknown> | undefined;
              if (body?.trustDevice === true)
                throw new APIError("BAD_REQUEST", {
                  code: "TRUSTED_DEVICE_DISABLED",
                  message: "Trusted devices are not supported.",
                });
              if (ctx.path === "/two-factor/enable" && body?.method === "otp")
                throw new APIError("BAD_REQUEST", {
                  code: "OTP_DISABLED",
                  message: "Only authenticator TOTP is supported.",
                });
              if (
                ctx.path === "/two-factor/enable" &&
                body?.issuer !== undefined &&
                body.issuer !== options.totp?.issuer
              )
                throw new APIError("BAD_REQUEST", {
                  code: "INVALID_TOTP_ISSUER",
                  message: "Use the configured authenticator issuer.",
                });
              return Promise.resolve();
            }),
          },
        }
      : {}),
    logger: { log: logAuth },
    // Let the Foundation handler sanitize unexpected errors instead of the
    // HTTP router's direct-console fallback (which ignores the custom logger).
    onAPIError: { throw: true },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await options.email.send({
          to: user.email,
          subject: "Reset your password",
          text: url,
        });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await options.email.send({
          to: user.email,
          subject: "Verify your email",
          text: url,
        });
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await options.email.send({
            to: email,
            subject: "Sign in",
            text: url,
          });
        },
      }),
      ...(options.totp
        ? [
            twoFactor({
              issuer: options.totp.issuer,
              allowPasswordless: false,
              skipVerificationOnEnable: false,
              totpOptions: { digits: 6, period: 30 },
              backupCodeOptions: { customBackupCodesGenerate: () => [] },
            }),
          ]
        : []),
    ],
    ...(options.google ? { socialProviders: { google: options.google } } : {}),
  });
  return {
    async handler(request) {
      const path = new URL(request.url).pathname.replace(/\/+$/, "");
      const indeterminate = Boolean(
        options.totp &&
        (path.includes("/two-factor/") || path.endsWith("/sign-in/email")),
      );
      let response: Response;
      try {
        response = await auth.handler(request);
      } catch {
        logAuth("error", "AUTH_ENDPOINT_FAILED");
        return Response.json(
          {
            code: indeterminate ? "AUTH_STATE_INDETERMINATE" : "AUTH_FAILURE",
            message: indeterminate
              ? "Authentication outcome could not be confirmed. Resolve your session before taking further action."
              : "Authentication request failed. Please try again.",
          },
          { status: 500, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (response.status >= 500) {
        logAuth("error", "AUTH_ENDPOINT_FAILED");
        if (indeterminate)
          return Response.json(
            {
              code: "AUTH_STATE_INDETERMINATE",
              message:
                "Authentication outcome could not be confirmed. Resolve your session before taking further action.",
            },
            { status: 500, headers: { "Cache-Control": "private, no-store" } },
          );
      }
      if (request.method !== "POST" || !response.ok) return response;
      const basePath = new URL((await auth.$context).baseURL).pathname.replace(
        /\/+$/,
        "",
      );
      if (
        new URL(request.url).pathname.replace(/\/+$/, "") !==
        `${basePath}/sign-out`
      )
        return response;

      try {
        // Check the original credential against durable storage. Do not renew it
        // or trust a cookie cache after Better Auth's best-effort deletion.
        const remaining = await auth.api.getSession({
          headers: request.headers,
          query: { disableRefresh: true, disableCookieCache: true },
        });
        if (!remaining) return response;
      } catch {
        // An unavailable authoritative store cannot confirm revocation.
      }
      // Do not forward success/clearing cookies on failure: retain the original
      // credential in the browser so a retry can actually revoke it.
      return Response.json(
        {
          code: "LOGOUT_UNCONFIRMED",
          message: "Could not confirm sign out. Please try again.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    },
    async resolveSession(headers) {
      const result = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      return { data: result.response, headers: result.headers };
    },
  };
}
