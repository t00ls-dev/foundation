import { createFoundationAuth, type FoundationSession } from "@t00ls-dev/auth";
import { createD1Database } from "@t00ls-dev/db/d1";
import { createResendEmail, type EmailProvider } from "@t00ls-dev/email";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema } from "../schema.js";
import { withLinksAuthEmail } from "./auth-email.js";
import {
  linksTurnstileActions,
  type TurnstileCapability,
} from "../shared/auth-config.js";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AUTH_SECRET: string;
  BASE_URL: string;
  DB: D1Database;
  EMAIL_FROM: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export type EmailFactory = (env: Env) => EmailProvider;
export const resendEmail: EmailFactory = (env) =>
  createResendEmail({
    apiKey: env.RESEND_API_KEY,
    defaultFrom: env.EMAIL_FROM,
  });

export class AuthConfigurationError extends Error {
  constructor() {
    super("Authentication is temporarily unavailable.");
  }
}

// Server-only: both auth and its public capability use this same decision.
export function resolveGoogleConfig(
  env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">,
) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret))
    throw new AuthConfigurationError();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function createRequestAuth(env: Env, emailFactory: EmailFactory) {
  const google = resolveGoogleConfig(env);
  const turnstile = resolveTurnstileCapability(env);
  const database = createD1Database(env.DB);
  const auth = createFoundationAuth({
    baseURL: env.BASE_URL,
    database: drizzleAdapter(database, { provider: "sqlite", schema }),
    email: withLinksAuthEmail(emailFactory(env)),
    ...(google ? { google } : {}),
    secret: env.AUTH_SECRET,
    ...(turnstile.status !== "disabled"
      ? {
          turnstile:
            turnstile.status === "enabled"
              ? {
                  secretKey: env.TURNSTILE_SECRET_KEY!.trim(),
                  allowedHostnames: [new URL(env.BASE_URL).hostname],
                  actions: linksTurnstileActions,
                }
              : { unavailable: true as const },
        }
      : {}),
    totp: { issuer: "Links", enrollmentEnabled: true },
    rateLimit: { storage: "database", ipAddressHeaders: ["cf-connecting-ip"] },
  });
  return { auth, database };
}

// Same decision for capability and enforcement. Partial configuration is never
// silently off and does not disable OAuth/TOTP/authenticated endpoints.
export function resolveTurnstileCapability(
  env: Pick<Env, "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY">,
): TurnstileCapability {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim();
  if (!siteKey && !secretKey) return { status: "disabled" };
  if (!siteKey || !secretKey) return { status: "unavailable" };
  return { status: "enabled", siteKey };
}

export type AppEnvironment = {
  Bindings: Env;
  Variables: {
    identity: FoundationSession;
    database: ReturnType<typeof createD1Database>;
  };
};
