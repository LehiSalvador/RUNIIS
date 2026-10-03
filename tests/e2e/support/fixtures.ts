import { test as base, expect, type Page } from "@playwright/test";
import { protectBypass } from "./bypass";

/**
 * Local fixtures for foundation specs. The header chip reads GET /api/v1/session (always 200); it is
 * exercised against intercepted responses so these specs never depend on a real session or a
 * running auth backend. Default is an anonymous visitor.
 */
export type MeFixture = "anonymous" | "authenticated";

export async function mockMe(page: Page, mode: MeFixture) {
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data:
          mode === "authenticated"
            ? { authenticated: true, display_name: "Corredora Sintética", avatar_url: null }
            : { authenticated: false },
      }),
    }),
  );
}

/** The session probe answers 200 for anonymous visitors, so no console error is expected noise. */
export function isExpectedConsoleNoise(_text: string): boolean {
  return false;
}

export const test = base.extend<{ consoleErrors: string[] }>({
  // Remote runs send the Vercel bypass header through extraHTTPHeaders; keep it off third-party origins.
  context: async ({ context }, provide) => {
    await protectBypass(context);
    await provide(context);
  },
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !isExpectedConsoleNoise(message.text())) errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      await mockMe(page, "anonymous");
      await use(errors);
    },
    { auto: true },
  ],
});

export { expect };

/** True when the focused element, or the visible box it wraps (checkbox/radio/stepper), draws an
 * outline -- the §2.8 focus ring. */
export async function focusRingVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const candidates = [active, ...Array.from(active.querySelectorAll<HTMLElement>("span"))];
    return candidates.some((el) => {
      const style = getComputedStyle(el);
      return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2;
    });
  });
}
