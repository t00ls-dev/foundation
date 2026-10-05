// Test-only entrypoint. Production imports src/worker.ts, never this mailbox.
import { createApp } from "../src/server/app.js";
import type { Env } from "../src/server/auth.js";

// Test-only provider transport, never imported by src/worker.ts. Production
// still uses Better Auth's sole Siteverify implementation, not this fixture.
const originalFetch = globalThis.fetch;
const consumed = new Set<string>();
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify")
    return originalFetch(input, init);
  const payload = JSON.parse(init?.body as string) as { response: string };
  const token = payload.response;
  if (token === "fixture-network")
    throw new Error("Fixture provider unavailable");
  if (token === "fixture-http") return Response.json({}, { status: 503 });
  if (!token.startsWith("fixture:") || consumed.has(token))
    return Response.json({
      "success": false,
      "error-codes": ["timeout-or-duplicate"],
    });
  consumed.add(token);
  return Response.json({
    success: true,
    hostname: "127.0.0.1",
    action: token.split(":")[1],
  });
};

const app = createApp((env) => ({
  async send(input) {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS _test_mail (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT NOT NULL, text TEXT NOT NULL)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO _test_mail (recipient, subject, text) VALUES (?, ?, ?)",
    )
      .bind(input.to, input.subject, input.text)
      .run();
  },
}));

app.get("/__test/mail", async (c) => {
  const message = await c.env.DB.prepare(
    "SELECT text FROM _test_mail WHERE recipient = ? AND subject = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(
      c.req.query("email") ?? "",
      c.req.query("subject") ?? "Verify your email",
    )
    .first<{ text: string }>();
  c.header("Cache-Control", "no-store");
  return message ? c.json(message) : c.json({ error: "No message" }, 404);
});

export default {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    const mode = request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)links_e2e_turnstile=([^;]+)/)?.[1];
    const bindings: Env = {
      ...env,
      ...(mode
        ? {
            TURNSTILE_SECRET_KEY: "fixture-server-only",
            ...(mode === "on" ? { TURNSTILE_SITE_KEY: "fixture-public" } : {}),
          }
        : {}),
    };
    return app.fetch(request, bindings, context);
  },
};
