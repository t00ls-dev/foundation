import { createFoundationAuth } from "@t00ls-dev/auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "../src/schema.js";
import { createTotpHarness, origin } from "./totp-harness.js";

// Exercise the real public wrapper and migration history, with the same public
// HTTP/cookie/OAuth helpers as characterization. Never expose its Better Auth API.
export async function createFoundationTotpHarness() {
  const h = await createTotpHarness(true);
  const policy = { enrollmentEnabled: true };
  const foundationAuth = () =>
    createFoundationAuth({
      baseURL: origin,
      secret: "characterization-secret-at-least-thirty-two-characters",
      database: drizzleAdapter(drizzle(h.binding), {
        provider: "sqlite",
        schema,
      }),
      email: { send: h.captureEmail },
      google: {
        clientId: "test-google-client",
        clientSecret: "test-google-secret",
      },
      totp: { issuer: "Links", enrollmentEnabled: policy.enrollmentEnabled },
      rateLimit: {
        storage: "database",
        enabled: h.rate.enabled ?? false,
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    });
  h.transport = (request) => foundationAuth().handler(request);
  return Object.assign(h, { foundationAuth, policy });
}
