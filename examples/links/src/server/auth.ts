import { createFoundationAuth, type FoundationSession } from "@t00ls-dev/auth";
import { createD1Database } from "@t00ls-dev/db/d1";
import { createResendEmail, type EmailProvider } from "@t00ls-dev/email";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema } from "../schema.js";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AUTH_SECRET: string;
  BASE_URL: string;
  DB: D1Database;
  EMAIL_FROM: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY: string;
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
  const database = createD1Database(env.DB);
  const auth = createFoundationAuth({
    baseURL: env.BASE_URL,
    database: drizzleAdapter(database, { provider: "sqlite", schema }),
    email: emailFactory(env),
    ...(google ? { google } : {}),
    secret: env.AUTH_SECRET,
    totp: { issuer: "Links", enrollmentEnabled: true },
    rateLimit: { storage: "database", ipAddressHeaders: ["cf-connecting-ip"] },
  });
  return { auth, database };
}

export type AppEnvironment = {
  Bindings: Env;
  Variables: {
    identity: FoundationSession;
    database: ReturnType<typeof createD1Database>;
  };
};
