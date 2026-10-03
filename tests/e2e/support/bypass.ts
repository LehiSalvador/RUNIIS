import type { BrowserContext } from "@playwright/test";
import { BYPASS_HEADER, SKIP_TOOLBAR_HEADER, e2eEnv } from "./env";

/**
 * `extraHTTPHeaders` applies to every request a context makes, including third-party origins (map
 * tiles, fonts). The Vercel bypass secret (and the skip-toolbar flag) must only ever reach the target
 * deployment, so requests to any other origin are re-issued without them. No-op outside remote mode.
 */
export async function protectBypass(context: BrowserContext, baseURL: string = e2eEnv().baseURL, enabled: boolean = e2eEnv().remote): Promise<void> {
  if (!enabled) return;
  const origin = new URL(baseURL).origin;
  await context.route(
    (url) => url.origin !== origin && (url.protocol === "http:" || url.protocol === "https:"),
    (route) => {
      const headers = { ...route.request().headers() };
      delete headers[BYPASS_HEADER];
      delete headers[SKIP_TOOLBAR_HEADER];
      return route.continue({ headers });
    },
  );
}
