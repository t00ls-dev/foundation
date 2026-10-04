import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Linked TSX sources otherwise add a module-fetch waterfall on every reload.
  optimizeDeps: {
    extensions: [".tsx"],
    include: [
      "@t00ls-dev/ui/components/skeleton",
      "@t00ls-dev/ui/patterns/page-progress",
      "@t00ls-dev/ui/patterns/pending-button",
      "@t00ls-dev/ui/patterns/inline-feedback",
      "@t00ls-dev/ui/patterns/feedback",
    ],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) },
  },
  plugins: [react(), tailwindcss(), cloudflare()],
});
