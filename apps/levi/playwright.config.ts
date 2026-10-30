import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "./e2e/reporter.ts",
  outputDir: ".local/playwright",
  preserveOutput: "never",
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [
    {
      name: "desktop",
      testMatch: /(?:onboarding|members|admin|layout)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4317" },
    },
    {
      name: "mobile",
      testMatch: /(?:onboarding|members|admin|layout)\.spec\.ts/,
      use: {
        ...devices["iPhone 13 Mini"],
        browserName: "chromium",
        baseURL: "http://localhost:4317",
      },
    },
    // Larguras e orientações adicionais para o layout responsivo.
    {
      name: "android-360",
      testMatch: /layout\.spec\.ts/,
      use: { ...devices["Galaxy S8"], baseURL: "http://localhost:4317" },
    },
    {
      name: "tablet",
      testMatch: /layout\.spec\.ts/,
      use: {
        ...devices["iPad Mini"],
        browserName: "chromium",
        baseURL: "http://localhost:4317",
      },
    },
    {
      name: "iphone-landscape",
      testMatch: /layout\.spec\.ts/,
      use: {
        ...devices["iPhone 13 Mini landscape"],
        browserName: "chromium",
        baseURL: "http://localhost:4317",
      },
    },
    ...(process.env.LEVI_WEBKIT === "1"
      ? [
          {
            name: "iphone-webkit",
            testMatch: /(?:onboarding|members|admin|layout)\.spec\.ts/,
            use: {
              ...devices["iPhone 13 Mini"],
              browserName: "webkit" as const,
              baseURL: "http://localhost:4317",
            },
          },
        ]
      : []),
    {
      name: "vite-proxy",
      testMatch: /(?:proxy|admin)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5173" },
    },
  ],
  webServer: [
    {
      command: "node --import tsx e2e/server.ts",
      url: "http://localhost:4317/",
      reuseExistingServer: false,
    },
    {
      command: "node --import tsx e2e/server.ts --proxy-api",
      url: "http://localhost:4318/",
      reuseExistingServer: false,
    },
    {
      command: "node node_modules/vite/bin/vite.js",
      env: { LEVI_PORT: "4318" },
      url: "http://localhost:5173/",
      reuseExistingServer: false,
    },
  ],
});
