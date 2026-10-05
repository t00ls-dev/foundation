import { Hono } from "hono";
import { expect, it } from "vitest";
import { foundationSecurityHeaders } from "../src/index.js";

it("Turnstile CSP is opt-in and allows only the official script/frame origins", async () => {
  for (const turnstile of [false, true]) {
    const app = new Hono();
    app.use("*", foundationSecurityHeaders({ turnstile }));
    app.get("/", (c) => c.text("ok"));
    const response = await app.request("/");
    const csp = response.headers.get("content-security-policy")!;
    expect(csp.includes("https://challenges.cloudflare.com")).toBe(turnstile);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("https://*");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    if (turnstile) {
      expect(csp).toContain(
        "script-src 'self' https://challenges.cloudflare.com",
      );
      expect(csp).toContain(
        "frame-src 'self' https://challenges.cloudflare.com",
      );
    }
  }
});
