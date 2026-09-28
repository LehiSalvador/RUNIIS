import { test as base, expect, type Page } from "@playwright/test";

/**
 * Local fixtures for foundation specs. GET /api/v1/me belongs to T20; the session chip is exercised
 * against intercepted responses so these specs never depend on a real session or a running auth
 * backend. Default is an anonymous visitor (401 AUTH_REQUIRED, the documented contract).
 */
export type MeFixture = "anonymous" | "authenticated";

export async function mockMe(page: Page, mode: MeFixture) {
  await page.route("**/api/v1/me", (route) =>
    mode === "authenticated"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { display_name: "Corredora Sintética", avatar_url: null }, meta: {} }),
        })
      : route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Debes iniciar sesión." } }),
        }),
  );
}

/** Chromium logs every non-2xx fetch as a console error; the anonymous /api/v1/me 401 is expected
 * (see T15 handoff finding on the anonymous /me contract), everything else is a real failure. */
export function isExpectedConsoleNoise(text: string): boolean {
  return /Failed to load resource: the server responded with a status of 401/.test(text);
}

export const test = base.extend<{ consoleErrors: string[] }>({
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
