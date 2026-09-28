import type { Page } from "@playwright/test";
import { scanForSeriousViolations } from "../support/axe";
import { SEED, availabilityBody, expect, localSql, stubMapTiles, test } from "./support";

const HISTORICAL_SLUG = "demo-libre-slug-anterior-e2e";

/** Master §56 page-level explanation (Alert: role alert or status). */
function notice(page: Page, text: string) {
  return page.locator('[role="alert"], [role="status"]').filter({ hasText: text }).first();
}

/** The CTA visible at the current viewport (inline below lg, summary card at lg+). */
function primaryCta(page: Page, testInfo: { project: { name: string } }) {
  const scope = testInfo.project.name === "chromium-desktop" ? page.getByRole("complementary", { name: "Resumen de inscripción" }) : page.locator("#cta-inline");
  return scope.locator("a, button").first();
}

test.describe("Event page (Master §58)", () => {
  test("OPEN + AVAILABLE: level 1 facts, 'Inscribirme' to /inscripcion, JSON-LD and canonical", async ({ page, consoleErrors }, testInfo) => {
    await page.goto(`/eventos/${SEED.open}`);
    await expect(page.getByRole("heading", { level: 1, name: "RUNIIS Demo Libre 5K/10K" })).toBeVisible();
    const cta = primaryCta(page, testInfo);
    await expect(cta).toHaveText("Inscribirme");
    await expect(cta).toHaveAttribute("href", `/inscripcion/${SEED.open}`);
    await expect(page.getByText("Inscripciones abiertas").first()).toBeVisible();

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/eventos/${SEED.open}$`));
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`/og/eventos/${SEED.open}$`));
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = ld.map((text) => JSON.parse(text) as Record<string, unknown>);
    const event = parsed.find((item) => item["@type"] === "SportsEvent");
    expect(event).toMatchObject({ name: "RUNIIS Demo Libre 5K/10K", eventStatus: "https://schema.org/EventScheduled" });
    expect(parsed.some((item) => item["@type"] === "BreadcrumbList")).toBe(true);

    const { serious } = await scanForSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  const STATES = [
    { slug: SEED.notOpen, cta: "Recordarme", notice: "Inscripciones próximamente" },
    { slug: SEED.postponed, cta: "Evento aplazado", notice: "Evento aplazado" },
    { slug: SEED.canceled, cta: "Evento cancelado", notice: "Evento cancelado" },
    { slug: SEED.finished, cta: "Evento realizado", notice: "Evento realizado" },
  ];
  for (const state of STATES) {
    test(`${state.slug}: CTA '${state.cta}' is disabled and explained`, async ({ page }, testInfo) => {
      await page.goto(`/eventos/${state.slug}`);
      const cta = primaryCta(page, testInfo);
      await expect(cta).toHaveText(state.cta);
      await expect(cta).toBeDisabled();
      await expect(notice(page, state.notice)).toBeVisible();
      // These states never read availability (it cannot change their CTA).
      expect(await page.evaluate(() => performance.getEntriesByType("resource").some((e) => e.name.includes("/availability")))).toBe(false);
    });
  }

  test("postponed without a new date never invents one", async ({ page }) => {
    await page.goto(`/eventos/${SEED.postponed}`);
    await expect(page.getByText("Nueva fecha por confirmar")).toBeVisible();
    await expect(page.getByText(/12:00 a\.m\.|00:00/)).toHaveCount(0);
  });

  const LIVE = [
    { state: "SOLD_OUT", cta: "Agotado", notice: "Ya no quedan lugares disponibles para esta edición." },
    { state: "TEMPORARILY_UNAVAILABLE", cta: "Temporalmente no disponible", notice: "Temporalmente sin disponibilidad" },
    { state: "LOW", cta: "Inscribirme", notice: "Pocos lugares" },
  ] as const;
  for (const live of LIVE) {
    test(`fresh availability ${live.state} drives the CTA (never cached)`, async ({ page }, testInfo) => {
      await page.route(`**/api/v1/events/${SEED.open}/availability`, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(availabilityBody(live.state)) }),
      );
      await page.goto(`/eventos/${SEED.open}`);
      await expect(primaryCta(page, testInfo)).toHaveText(live.cta);
      await expect(notice(page, live.notice)).toBeVisible();
      if (live.state === "TEMPORARILY_UNAVAILABLE") await expect(page.getByText("Agotado")).toHaveCount(0);
    });
  }

  test("availability request failure falls back honestly", async ({ page }, testInfo) => {
    await page.route(`**/api/v1/events/${SEED.open}/availability`, (route) => route.fulfill({ status: 503, body: "{}" }));
    await page.goto(`/eventos/${SEED.open}`);
    await expect(primaryCta(page, testInfo)).toHaveText("Inscribirme");
    await expect(page.getByText("No pudimos confirmar la disponibilidad en este momento").filter({ visible: true })).toBeVisible();
  });

  test("availability is fetched fresh with no-store", async ({ page }) => {
    const request = page.waitForRequest(`**/api/v1/events/${SEED.open}/availability`);
    const response = page.waitForResponse(`**/api/v1/events/${SEED.open}/availability`);
    await page.goto(`/eventos/${SEED.open}`);
    await request;
    expect((await response).headers()["cache-control"]).toBe("no-store");
  });

  test("route map renders lazily from our GeoJSON, with the text summary always present", async ({ page }) => {
    await page.goto(`/eventos/${SEED.open}`);
    const text = page.getByTestId("route-text");
    await expect(text).toContainText("Salida Parque Fundidora");
    await expect(text).toContainText("Meta Parque Fundidora");
    await expect(text).toContainText("Hidratación km 2.5");
    await page.getByRole("heading", { name: "Ruta", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByTestId("route-map")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
    const canvas = page.getByTestId("route-map").locator("canvas");
    await canvas.focus();
    await expect(canvas).toBeFocused();
    await expect(page.getByRole("button", { name: "Acercar" })).toBeVisible();
  });

  test("route map falls back to text when tiles fail", async ({ page }) => {
    await stubMapTiles(page, "fail");
    await page.goto(`/eventos/${SEED.open}`);
    await page.getByRole("heading", { name: "Ruta", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByTestId("route-map-fallback")).toContainText("El mapa no está disponible en este momento", { timeout: 20_000 });
    await expect(page.getByTestId("route-text")).toContainText("Salida Parque Fundidora");
  });

  test("mobile sticky CTA appears after scrolling past the inline CTA", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-desktop", "lg+ uses the sticky summary card");
    await page.goto(`/eventos/${SEED.openPaid}`);
    const sticky = page.getByTestId("sticky-cta");
    await expect(sticky).toHaveAttribute("aria-hidden", "true");
    await page.getByRole("heading", { name: "Preguntas frecuentes" }).scrollIntoViewIfNeeded();
    await expect(sticky).toHaveAttribute("aria-hidden", "false");
    await expect(sticky.getByRole("link", { name: "Inscribirme" })).toBeVisible();
    await expect(sticky).toContainText("$350 – $600");
  });

  test("FAQ disclosure works from the keyboard", async ({ page }) => {
    await page.goto(`/eventos/${SEED.open}`);
    const summary = page.locator("summary", { hasText: "¿Dónde recojo mi kit?" });
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("En la Macroplaza, un día antes de la carrera.")).toBeVisible();
  });

  test("unknown slug renders the styled 404", async ({ page }) => {
    const response = await page.goto("/eventos/no-existe-esta-carrera");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
  });
});

test.describe("historical slug (Master §59)", () => {
  test.beforeAll(() => {
    localSql(
      `insert into app.edition_slug_history (edition_id, old_slug, new_slug) values ('50000000-0000-4000-8000-000000900001', '${HISTORICAL_SLUG}', '${SEED.open}') on conflict (old_slug) do nothing`,
    );
  });
  test.afterAll(() => {
    // slug history is append-only (reject_mutation trigger); the synthetic row is removed with
    // triggers off for this local session only.
    localSql(`set session_replication_role = replica; delete from app.edition_slug_history where old_slug = '${HISTORICAL_SLUG}'`);
  });

  test("permanently redirects to the current slug", async ({ page, request }) => {
    const raw = await request.get(`/eventos/${HISTORICAL_SLUG}`, { maxRedirects: 0 });
    expect(raw.status()).toBe(308);
    expect(raw.headers()["location"]).toMatch(new RegExp(`/eventos/${SEED.open}$`));
    await page.goto(`/eventos/${HISTORICAL_SLUG}`);
    await expect(page).toHaveURL(new RegExp(`/eventos/${SEED.open}$`));
  });
});
