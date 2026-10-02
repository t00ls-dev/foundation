import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    ...(process.env.GITHUB_ACTIONS === "true"
      ? {
          reporters: [
            "default",
            [
              "github-actions",
              { jobSummary: { title: "Integration Tests — Links/D1" } },
            ],
          ],
        }
      : {}),
  },
});
