import process from "node:process";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const path = process.env.LINKS_E2E_STATE;
  if (!path)
    throw new Error("Start this test configuration through e2e/start.ts");
  return {
    plugins: [
      react(),
      tailwindcss(),
      cloudflare({
        configPath: "e2e/wrangler.jsonc",
        persistState: { path },
        inspectorPort: false,
      }),
    ],
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
  };
});
