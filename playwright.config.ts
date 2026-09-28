import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";

/**
 * Foundation Playwright config (T15 brief): reuses the shared local dev server on port 3100 that
 * salvaops-frontend owns starting, rather than spawning a second one -- other agents run concurrently
 * against the same server. Three projects cover the desktop/mobile/tablet matrix the brief requires.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm exec next dev -p 3100",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "chromium-tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
  ],
});
