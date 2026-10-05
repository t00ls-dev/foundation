import { secureHeaders } from "hono/secure-headers";

export { foundationCors } from "./cors.js";
export type { FoundationCorsOptions } from "./cors.js";
export { csrfProtection } from "./csrf.js";
export type { CsrfProtectionOptions } from "./csrf.js";
export { fixedWindowRateLimit } from "./rate-limit.js";
export type {
  FixedWindowRateLimitOptions,
  FixedWindowRateLimitStore,
} from "./rate-limit.js";
export { verifyTurnstile } from "./turnstile.js";
export type {
  TurnstileVerification,
  VerifyTurnstileOptions,
} from "./turnstile.js";

export interface FoundationSecurityHeadersOptions {
  /** Allow only the official widget script/frame; default policy stays self-only. */
  turnstile?: boolean;
}

export function foundationSecurityHeaders(
  options: FoundationSecurityHeadersOptions = {},
) {
  return secureHeaders({
    contentSecurityPolicy: {
      connectSrc: ["'self'"],
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: [
        "'self'",
        ...(options.turnstile ? ["https://challenges.cloudflare.com"] : []),
      ],
      ...(options.turnstile
        ? { frameSrc: ["'self'", "https://challenges.cloudflare.com"] }
        : {}),
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
  });
}

export function privateResponseHeaders(headers: Headers): Headers {
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return headers;
}
