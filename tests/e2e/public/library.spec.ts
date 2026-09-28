import { scanForSeriousViolations } from "../support/axe";
import { SEED, expect, test } from "./support";

test.describe("/eventos library (Master §54-56)", () => {
  test("upcoming first, past in its own section, cursor 'Cargar más' appends without duplicates", async ({ page, consoleErrors }) => {
    await page.goto("/eventos");
    await expect(page.getByRole("heading", { level: 1, name: "Eventos" })).toBeVisible();
    const upcoming = page.locator("section[aria-labelledby=proximos]");
    const past = page.locator("section[aria-labelledby=anteriores]");
    await expect(upcoming.getByRole("article").first()).toBeVisible();

    // The seed has more Editions than one page (6): page through with the cursor.
    const loadMore = page.getByRole("button", { name: "Cargar más" });
    await expect(loadMore).toBeVisible();
    while (await loadMore.isVisible()) {
      const before = await page.getByRole("article").count();
      await loadMore.click();
      await expect.poll(() => page.getByRole("article").count()).toBeGreaterThan(before);
    }
    await expect(upcoming.getByRole("link", { name: "RUNIIS Demo Libre 5K/10K" })).toBeVisible();
    await expect(past.getByRole("link", { name: "RUNIIS Demo Cancelada" })).toBeVisible();
    await expect(past.getByRole("link", { name: "RUNIIS Demo Finalizada 2025" })).toBeVisible();
    await expect(upcoming.getByRole("link", { name: "RUNIIS Demo Cancelada" })).toHaveCount(0);
    const hrefs = await page.getByRole("article").locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(new Set(hrefs).size).toBe(hrefs.length);

    const { serious } = await scanForSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("a failed 'Cargar más' is an inline error, and the retry works", async ({ page }) => {
    await page.goto("/eventos");
    let fail = true;
    await page.route("**/api/v1/events?*cursor=*", (route) =>
      fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE" } }) }) : route.fallback(),
    );
    await page.getByRole("button", { name: "Cargar más" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "No pudimos cargar más eventos" })).toBeVisible();
    fail = false;
    const before = await page.getByRole("article").count();
    await page.getByRole("button", { name: "Cargar más" }).click();
    await expect.poll(() => page.getByRole("article").count()).toBeGreaterThan(before);
    await expect(page.getByRole("alert").filter({ hasText: "No pudimos cargar más eventos" })).toHaveCount(0);
  });

  test("search without matches vs filters without results are distinct states", async ({ page }) => {
    await page.goto("/eventos?q=zzzz-sin-coincidencia");
    await expect(page.getByRole("heading", { name: "Sin coincidencias para “zzzz-sin-coincidencia”" })).toBeVisible();
    await expect(page.getByText("Ningún evento coincide con tus filtros")).toHaveCount(0);

    await page.goto("/eventos?type=HIKE");
    await expect(page.getByRole("heading", { name: "Ningún evento coincide con tus filtros" })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Limpiar filtros" }).last().click();
    await expect(page).toHaveURL(/\/eventos$/);
    await expect(page.getByRole("article").first()).toBeVisible();
  });

  test("filters (desktop sidebar) live in the URL and are restored after visiting an Event page", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "sidebar is lg+");
    // Scoped to the seeded demo Editions (other suites add their own to the shared DB).
    await page.goto("/eventos?q=RUNIIS+Demo");
    const sidebar = page.getByRole("complementary", { name: "Filtros" });
    await sidebar.getByRole("checkbox", { name: "Solo con inscripciones abiertas" }).click();
    await expect(page).toHaveURL(/registration_open=true/);
    await sidebar.getByRole("checkbox", { name: "Gratis" }).click();
    await expect(page).toHaveURL(/price=FREE/);
    await expect(page.getByRole("button", { name: /Gratis \(quitar filtro\)/ })).toBeVisible();
    // AND across dimensions: open + free leaves only the free open Edition.
    await expect(page.getByRole("link", { name: "RUNIIS Demo Libre 5K/10K" })).toBeVisible();
    await expect(page.getByRole("link", { name: "RUNIIS Demo Pago 10K/21K" })).toHaveCount(0);
    // OR within a dimension: adding "De pago" brings the paid one back.
    await sidebar.getByRole("checkbox", { name: "De pago" }).click();
    await expect(page.getByRole("link", { name: "RUNIIS Demo Pago 10K/21K" })).toBeVisible();

    await page.getByRole("link", { name: "RUNIIS Demo Libre 5K/10K" }).click();
    await expect(page).toHaveURL(`/eventos/${SEED.open}`);
    await page.goBack();
    await expect(page).toHaveURL(/q=RUNIIS\+Demo.*registration_open=true/);
    await expect(page.getByRole("searchbox", { name: /Buscar por nombre/ })).toHaveValue("RUNIIS Demo");
    await expect(sidebar.getByRole("checkbox", { name: "Solo con inscripciones abiertas" })).toBeChecked();
    await expect(sidebar.getByRole("checkbox", { name: "De pago" })).toBeChecked();
  });

  test("date filter validates in place and never sends an invalid range", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "sidebar is lg+");
    await page.goto("/eventos");
    const sidebar = page.getByRole("complementary", { name: "Filtros" });
    const from = sidebar.getByRole("textbox", { name: "Desde" });
    const to = sidebar.getByRole("textbox", { name: "Hasta" });
    await from.fill("31022026");
    await expect(sidebar.getByText("Escribe una fecha válida con el formato dd/mm/aaaa.")).toBeVisible();
    await expect(from).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/eventos$/);
    await from.fill("01122026");
    await expect(page).toHaveURL(/date_from=2026-12-01/);
    await to.fill("01112026");
    await expect(sidebar.getByText("La fecha final no puede ser anterior a la inicial.")).toBeVisible();
    await expect(page).not.toHaveURL(/date_to=/);
  });

  test("mobile/tablet: filters open in a bottom sheet, apply to the URL, and focus returns", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-desktop", "drawer is below lg");
    await page.goto("/eventos?q=RUNIIS+Demo");
    const trigger = page.getByRole("button", { name: "Filtros", exact: true });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Filtros" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("checkbox", { name: "Gratis" }).click();
    const apply = drawer.getByRole("button", { name: /^Ver \d+\+? resultados?$/ });
    await expect(apply).toBeVisible();
    const { serious } = await scanForSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    await apply.click();
    await expect(page).toHaveURL(/price=FREE/);
    await expect(page.getByRole("button", { name: "Filtros, 1 activos" })).toBeVisible();
    await expect(page.getByRole("link", { name: "RUNIIS Demo Pago 10K/21K" })).toHaveCount(0);

    await page.getByRole("button", { name: "Filtros, 1 activos" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Filtros, 1 activos" })).toBeFocused();
  });

  test("filtered URLs are canonical to /eventos (Master §55)", async ({ page }) => {
    await page.goto("/eventos?registration_open=true&q=demo");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/eventos$/);
  });

  test("no horizontal overflow", async ({ page }) => {
    await page.goto("/eventos?registration_open=true&price=FREE&type=ROAD_RACE");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
