import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:5175";

test("built SPA, static asset and Worker responses carry the central security policy", async ({
  request,
}) => {
  const home = await request.get(`${origin}/`);
  const html = await home.text();
  expect(home.status(), html).toBe(200);
  expect(html).toContain('type="module"');
  const script = html.match(/src="([^"]+\.js)"/)?.[1];
  expect(script).toBeTruthy();
  for (const path of ["/", "/bookmarks", script!, "/health"]) {
    const response = await request.get(`${origin}${path}`);
    expect(response.status(), path).toBe(200);
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain(
      "default-src 'self'",
    );
    expect(headers["content-security-policy"], path).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["content-security-policy"], path).toContain(
      "object-src 'none'",
    );
    expect(headers["content-security-policy"], path).not.toContain("https://*");
    expect(headers["content-security-policy"], path).toContain(
      "script-src 'self' https://challenges.cloudflare.com",
    );
    expect(headers["content-security-policy"], path).toContain(
      "frame-src 'self' https://challenges.cloudflare.com",
    );
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["referrer-policy"], path).toBe(
      "strict-origin-when-cross-origin",
    );
    if (path === "/" || path === "/bookmarks") {
      expect(headers["content-type"]).toContain("text/html");
      expect(await response.text()).toBe(html);
    } else if (path === "/health") {
      expect(headers["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({
        status: "ok",
        checks: { worker: "ok", database: "ok" },
      });
    } else {
      expect(headers["content-type"]).toMatch(/javascript/);
      expect(await response.text()).not.toContain("<!doctype html>");
    }
  }
});
