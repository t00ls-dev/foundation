import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    ...(process.env.GITHUB_ACTIONS === "true"
      ? {
          reporters: [
            "default",
            ["github-actions", { jobSummary: { title: "Unit Tests" } }],
          ],
        }
      : {}),
  },
});
