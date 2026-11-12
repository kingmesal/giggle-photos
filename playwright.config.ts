import { defineConfig, devices } from "@playwright/test";

// Override with E2E_PORT when 3000 is already taken on the machine.
const E2E_PORT = process.env.E2E_PORT ?? "3000";
const BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run tests/e2e/serve.ts",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
});
