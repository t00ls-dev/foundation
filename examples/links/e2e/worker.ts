// Test-only entrypoint. Production imports src/worker.ts, never this mailbox.
import { createApp } from "../src/server/app.js";

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

export default app;
