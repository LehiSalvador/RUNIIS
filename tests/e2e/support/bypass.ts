import type { BrowserContext } from "@playwright/test";
import { BYPASS_HEADER, e2eEnv } from "./env";

/**
 * `extraHTTPHeaders` applies to every request a context makes, including third-party origins (map
 * tiles, fonts). The Vercel bypass secret must only ever reach the target deployment, so requests
 * to any other origin are re-issued without the header. No-op when no bypass secret is configured.
 */
export async function protectBypass(context: BrowserContext, baseURL: string = e2eEnv().baseURL, enabled: boolean = e2eEnv().hasBypass): Promise<void> {
  if (!enabled) return;
  const origin = new URL(baseURL).origin;
  await context.route(
    (url) => url.origin !== origin && (url.protocol === "http:" || url.protocol === "https:"),
    (route) => {
      const headers = { ...route.request().headers() };
      delete headers[BYPASS_HEADER];
      return route.continue({ headers });
    },
  );
}
