import type { Page } from "@playwright/test";
import { e2eEnv } from "./env";

/**
 * Waits for the page to go quiet before measuring it. Locally that is plain `networkidle` (unchanged).
 * On a deployed target, Next's viewport prefetching of every nav link (shells with long navs, redirect
 * chains for anonymous visitors) and platform-side connections can keep the network busy indefinitely,
 * so `networkidle` is only a bounded best effort there; the page is then considered settled once
 * `load` is done, web fonts are ready and no finite animation is still running.
 */
export async function settleNetwork(page: Page): Promise<void> {
  if (!e2eEnv().remote) {
    await page.waitForLoadState("networkidle");
    return;
  }
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity),
  );
}
