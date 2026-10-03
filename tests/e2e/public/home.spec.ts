import { scanForSeriousViolations } from "../support/axe";
import { NO_FIXTURE_EVENT, openEditionSlug } from "../support/targets";
import { expect, test } from "./support";

test.describe("Home (Master §53)", () => {
  test("sections render in Master order, cards link to Event pages, no console errors, axe clean", async ({ page, consoleErrors }) => {
    test.skip(openEditionSlug() === null, NO_FIXTURE_EVENT);
    await page.goto("/");
    await expect(page).toHaveTitle("RUNIIS — Descubre carreras e inscríbete");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText("Descubre carreras, inscríbete y consulta tu ranking verificado.");

    const headings = await page.getByRole("heading", { level: 2 }).allInnerTexts();
    const order = ["Próximas carreras", "Busca en la biblioteca de eventos", "Eventos creados y operados por RUNIIS", "¿Dudas sobre una carrera?"].map((h) =>
      headings.findIndex((text) => text.includes(h)),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // community_slot is unavailable until rankings exist: the block is omitted, not faked.
    await expect(page.getByText(/podio/i)).toHaveCount(0);

    const upcoming = page.locator("section[aria-labelledby=proximas-carreras]");
    // The shared local DB also holds other suites' Editions, so assert shape, not a specific card.
    const firstCard = upcoming.getByRole("article").first().getByRole("link");
    await expect(firstCard).toHaveAttribute("href", /^\/eventos\/[a-z0-9-]+$/);
    await expect(page.getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/eventos");

    const { serious } = await scanForSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("library search box submits to /eventos?q=", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("searchbox", { name: "Buscar eventos" });
    await box.fill("monterrey");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/eventos\?q=monterrey$/);
    await expect(page.getByRole("searchbox", { name: /Buscar por nombre/ })).toHaveValue("monterrey");
  });

  test("keyboard: skip link, then the primary CTA is reachable and focus is visible", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
    const cta = page.getByRole("link", { name: "Ver próximas carreras" });
    await cta.focus();
    const outline = await cta.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/eventos$/);
  });

  test("no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
