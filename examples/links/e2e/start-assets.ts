// Exercise the built production Worker and real Workers Assets routing, not
// Vite's development HTML transform or the test-only authentication entrypoint.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const state = await mkdtemp(join(tmpdir(), "links-assets-e2e-"));
const worker = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--config",
    "dist/foundation/wrangler.json",
    "--port",
    "5175",
    "--persist-to",
    state,
    "--var",
    "TURNSTILE_SITE_KEY:fixture-public",
    "--var",
    "TURNSTILE_SECRET_KEY:fixture-server-only",
  ],
  { stdio: "inherit" },
);
process.once("SIGTERM", () => worker.kill("SIGTERM"));
process.once("SIGINT", () => worker.kill("SIGINT"));
worker.once("exit", (code) => {
  void rm(state, { recursive: true, force: true }).then(() =>
    process.exit(code ?? 0),
  );
});
