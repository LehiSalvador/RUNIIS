import { defineConfig, devices } from "@playwright/test";
import { describeE2eEnv, resolveE2eEnv } from "./tests/e2e/support/env";

const e2e = resolveE2eEnv();
// One run id for the whole run: workers re-evaluate this file but inherit the variable.
process.env.E2E_RUN_ID = e2e.runId;
if (e2e.remote && !process.env.PW_E2E_BANNER_PRINTED) {
  process.env.PW_E2E_BANNER_PRINTED = "1";
  console.log(`[e2e] ${describeE2eEnv(e2e)}`);
}

/**
 * Playwright config. LOCAL (default): reuses the shared local dev server on port 3100 (other agents
 * run concurrently against the same server; it is started only if nobody else did). REMOTE
 * (E2E_BASE_URL set, see tests/e2e/support/env.ts and tests/e2e/README.md): no dev server, the Vercel
 * automation-bypass header (E2E_VERCEL_BYPASS) and x-vercel-skip-toolbar are sent on every request through
 * extraHTTPHeaders and stripped from third-party origins by the fixtures in tests/e2e/support/fixtures.ts, and traces and
 * videos stay off so the secret can never land in an artifact. Remote mode only accepts the staging origin or loopback
 * (tests/e2e/support/env.ts), and failure output is scrubbed of headers and cookies by the first reporter. Three projects cover the
 * desktop/mobile/tablet matrix.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI || e2e.remote ? 1 : 0,
  workers: e2e.workers,
  // The redacting reporter MUST stay first: it scrubs the call logs Playwright appends to API failures (request
  // headers incl. the bypass secret and cookies) before list/html format them (H2P2-04).
  reporter: [["./tests/e2e/support/redacting-reporter.ts"], ["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: e2e.baseURL,
    extraHTTPHeaders: e2e.extraHeaders,
    trace: e2e.remote ? "off" : "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: e2e.remote
    ? undefined
    : {
        command: "pnpm exec next dev -p 3100",
        url: e2e.baseURL,
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
