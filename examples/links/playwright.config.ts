import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node --experimental-strip-types e2e/start.ts",
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:5174/health",
    },
    {
      command: "node --experimental-strip-types e2e/start-assets.ts",
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:5175/health",
    },
  ],
});
