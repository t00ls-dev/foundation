import { expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import type { Env } from "../../src/server/auth.js";

it.each([false, true])(
  "keeps security headers on the final ASSETS.fetch and Worker responses (Turnstile %s)",
  async (turnstile) => {
    const env: Env = {
      ASSETS: {
        fetch: () =>
          Promise.resolve(
            new Response("SPA", {
              headers: { "Content-Type": "text/html", "ETag": '"fixture"' },
            }),
          ),
      },
      DB: {} as D1Database,
      BASE_URL: "http://localhost:3000",
      AUTH_SECRET: "fixture-auth-secret-at-least-thirty-two-characters",
      EMAIL_FROM: "fixture@example.com",
      RESEND_API_KEY: "unused",
      ...(turnstile
        ? {
            TURNSTILE_SITE_KEY: "fixture-public-key",
            TURNSTILE_SECRET_KEY: "fixture-secret-key",
          }
        : {}),
    };
    const app = createApp();
    for (const path of ["/", "/bookmarks", "/api/config"]) {
      const response = await app.request(path, undefined, env);
      expect(response.status).toBe(200);
      const csp = response.headers.get("Content-Security-Policy")!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp.includes("https://challenges.cloudflare.com")).toBe(turnstile);
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Referrer-Policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      if (path !== "/api/config") {
        expect(await response.text()).toBe("SPA");
        expect(response.headers.get("ETag")).toBe('"fixture"');
      }
    }
  },
);
