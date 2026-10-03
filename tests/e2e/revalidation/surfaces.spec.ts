import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { createReadyUser, signInViaApi, uniqueEmail } from "../support/account";
import { e2eEnv } from "../support/env";
import { NO_FIXTURE_EVENT, openEditionSlug } from "../support/targets";
import { expect, gotoAndSettle, test, unexpectedConsoleErrors } from "../account/support";
import { stubMapTiles } from "../public/support";

/**
 * Roadmap 8.3 revalidation sweep (P2-AC-01.b / P2-AC-14.a): every inherited F1/F2 participant surface is
 * loaded on the target, must render its single h1 without console errors or horizontal overflow, and is
 * scanned with axe (WCAG 2.2 AA tags). Serious/critical violations fail the test; every violation of any
 * impact is written to the axe evidence directory so the run's summary can list moderate/minor ones too.
 */
test.describe.configure({ timeout: 180_000 });

const AXE_DIR = ".salvaops-agent-evidence/P2-A-e2e-harness-revalidation/axe";

async function sweep(page: Page, testInfo: TestInfo, key: string, options: { expectH1?: string | RegExp } = {}) {
  // Settled UI only: finite animations (dialog/fade) must be done; endless ones (spinners, shimmers) are ignored.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  mkdirSync(AXE_DIR, { recursive: true });
  const findings = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact ?? "unknown",
    help: violation.help,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
  }));
  writeFileSync(
    `${AXE_DIR}/${testInfo.project.name}--${key}.json`,
    JSON.stringify({ page: key, project: testInfo.project.name, url: new URL(page.url()).pathname, passes: results.passes.length, findings }, null, 2),
  );
  const blocking = findings.filter((finding) => finding.impact === "serious" || finding.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

  await expect(page.locator("h1")).toHaveCount(1);
  if (options.expectH1) await expect(page.getByRole("heading", { level: 1 })).toHaveText(options.expectH1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

test.describe("public surfaces", () => {
  for (const { key, path, h1 } of [
    { key: "home", path: "/", h1: /Descubre carreras/ },
    { key: "eventos", path: "/eventos", h1: "Eventos" },
    { key: "contacto", path: "/contacto", h1: "Contacto" },
    { key: "runiis", path: "/runiis", h1: "Sobre RUNIIS" },
    { key: "legal-terminos", path: "/legal/terminos", h1: "Términos y condiciones" },
    { key: "legal-privacidad", path: "/legal/privacidad", h1: "Aviso de privacidad" },
    { key: "entrar", path: "/entrar", h1: "Entra a RUNIIS" },
  ]) {
    test(`${path} renders and is axe clean`, async ({ page, consoleErrors }, testInfo) => {
      await gotoAndSettle(page, path);
      await sweep(page, testInfo, key, { expectH1: h1 });
      expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
    });
  }

  test("event page of the fixture Edition renders its facts, canonical, JSON-LD and axe clean", async ({ page, consoleErrors }, testInfo) => {
    const slug = openEditionSlug();
    test.skip(slug === null, NO_FIXTURE_EVENT);
    await stubMapTiles(page, "ok");
    const response = await page.goto(`/eventos/${slug}`);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/eventos/${slug}$`));
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text) as Record<string, unknown>);
    expect(ld.some((item) => item["@type"] === "SportsEvent")).toBe(true);
    expect(ld.some((item) => item["@type"] === "BreadcrumbList")).toBe(true);
    await sweep(page, testInfo, "evento");
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });
});

test.describe("signed-in surfaces", () => {
  test("onboarding (fresh sign-in) renders and is axe clean", async ({ page, consoleErrors }, testInfo) => {
    await signInViaApi(page.request, uniqueEmail("onb"));
    await gotoAndSettle(page, "/onboarding");
    await sweep(page, testInfo, "onboarding", { expectH1: "Completa tu perfil" });
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("account sections render their empty states and are axe clean", async ({ page, consoleErrors }, testInfo) => {
    await createReadyUser(page, "sweep");
    for (const { key, path, h1 } of [
      { key: "cuenta", path: "/cuenta", h1: "Resumen" },
      { key: "cuenta-perfil", path: "/cuenta/perfil", h1: "Perfil" },
      { key: "cuenta-amigos", path: "/cuenta/amigos", h1: "Amigos" },
      { key: "cuenta-invitados", path: "/cuenta/invitados", h1: "Invitados" },
      { key: "cuenta-menores", path: "/cuenta/menores", h1: /Menores/ },
      { key: "cuenta-solicitudes", path: "/cuenta/solicitudes", h1: "Solicitudes" },
      { key: "cuenta-pases", path: "/cuenta/pases", h1: "Pases" },
      { key: "cuenta-favoritos", path: "/cuenta/favoritos", h1: "Favoritos" },
      { key: "cuenta-comunicaciones", path: "/cuenta/comunicaciones", h1: "Comunicaciones" },
    ]) {
      await test.step(path, async () => {
        const response = await page.goto(path);
        expect(response?.status(), `${path} status`).toBe(200);
        await page.waitForLoadState("networkidle");
        await sweep(page, testInfo, key, { expectH1: h1 });
      });
    }
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });
});
