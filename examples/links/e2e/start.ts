import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createServer } from "vite";

const state = await mkdtemp(join(tmpdir(), "links-e2e-"));
process.env.LINKS_E2E_STATE = state;
try {
  const migrate = () =>
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        "DB",
        "--local",
        "--config",
        "e2e/wrangler.jsonc",
        "--persist-to",
        state,
      ],
      { stdio: "inherit" },
    );
  migrate();
  // Wrangler's migration journal must make a second apply a no-op.
  migrate();
  const server = await createServer({ configFile: "vite.e2e.config.ts" });
  await server.listen();
  const close = async () => {
    await server.close();
    await rm(state, { recursive: true, force: true });
    process.exit(0);
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
} catch (error) {
  await rm(state, { recursive: true, force: true });
  throw error;
}
