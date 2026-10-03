import { scanForSeriousViolations } from "../support/axe";
import { hasSeededEditions, isIndexableTarget, NO_FIXTURE_EVENT, openEditionSlug } from "../support/targets";
import { SEED, expect, test } from "./support";

test.describe("static public pages", () => {
  for (const { path, h1 } of [
    { path: "/runiis", h1: "Sobre RUNIIS" },
    { path: "/contacto", h1: "Contacto" },
  ]) {
    test(`${path} renders, carries the environment's robots policy and is axe clean`, async ({ page, request, consoleErrors }) => {
      const indexable = await isIndexableTarget(request);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
      // AUD-015: only production is indexable; local/staging/preview carry noindex on every page.
      if (indexable) await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      else await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${path}$`));
      const { serious } = await scanForSeriousViolations(page);
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("/contacto states the general channel honestly (no invented number)", async ({ page }) => {
    await page.goto("/contacto");
    await expect(page.getByText("El canal general de contacto de RUNIIS está en configuración.", { exact: false })).toBeVisible();
    await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
  });

  for (const { path, title } of [
    { path: "/legal/terminos", title: "Términos y condiciones" },
    { path: "/legal/privacidad", title: "Aviso de privacidad" },
  ]) {
    // The shared local DB may or may not hold a published version (other suites publish test
    // documents), so the expected state is read from the public API first.
    test(`${path}: published version or 'Documento en preparación' + noindex`, async ({ page, request }) => {
      const key = path.endsWith("terminos") ? "TERMS_OF_SERVICE" : "PRIVACY_NOTICE";
      const api = await request.get(`/api/v1/legal/${key}`);
      const indexable = await isIndexableTarget(request);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      if (api.status() === 404) {
        await expect(page.getByRole("heading", { name: "Documento en preparación" })).toBeVisible();
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      } else {
        const { data } = (await api.json()) as { data: { version: number } };
        await expect(page.getByText(`Versión ${data.version} · publicada el`)).toBeVisible();
        if (indexable) await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
        else await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      }
      const { serious } = await scanForSeriousViolations(page);
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    });
  }

  test("unmatched URL renders the styled 404 inside the public chrome", async ({ page }) => {
    const response = await page.goto("/esta-ruta-no-existe");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    const { serious } = await scanForSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
});

test.describe("SEO files", () => {
  test("robots.txt: blanket Disallow outside production (AUD-015); private surfaces + sitemap in production", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "viewport-independent");
    const body = await (await request.get("/robots.txt")).text();
    if (!(await isIndexableTarget(request))) {
      expect(body).toMatch(/^Disallow:\s*\/\s*$/m);
      expect(body).not.toMatch(/^Allow:/im);
      expect(body).not.toMatch(/Sitemap:/i);
      return;
    }
    for (const path of ["/admin", "/cuenta", "/scanner", "/inscripcion", "/api", "/design-system", "/onboarding", "/entrar"]) {
      expect(body).toContain(`Disallow: ${path}`);
    }
    expect(body).toMatch(/Sitemap: .*\/sitemap\.xml/);
  });

  test("sitemap lists static pages and published Editions, not unpublished legal pages", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "viewport-independent");
    const body = await (await request.get("/sitemap.xml")).text();
    expect(body).toMatch(/<loc>[^<]*\/eventos<\/loc>/);
    const slug = openEditionSlug();
    if (slug) expect(body).toContain(`/eventos/${slug}</loc>`);
    if (hasSeededEditions()) expect(body).toContain(`/eventos/${SEED.finished}</loc>`);
    // Oracle = the rendered page, not the live API: the sitemap and the legal pages share one cache tag,
    // while the API reads the DB directly and moves whenever another suite publishes/unpublishes a version.
    const page = await (await request.get("/legal/terminos")).text();
    expect(body.includes("/legal/terminos")).toBe(!page.includes("Documento en preparación"));
  });

  test("social images are generated for the site and each Edition", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "viewport-independent");
    const slug = openEditionSlug();
    test.skip(slug === null, NO_FIXTURE_EVENT);
    for (const path of ["/og", `/og/eventos/${slug}`]) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
    }
    expect((await request.get("/og/eventos/no-existe")).status()).toBe(404);
  });

  test("public pages carry the nonce-free CSP that allows the map, private ones keep the nonce", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "viewport-independent");
    const slug = openEditionSlug();
    test.skip(slug === null, NO_FIXTURE_EVENT);
    const publicCsp = (await request.get(`/eventos/${slug}`)).headers()["content-security-policy"];
    expect(publicCsp).toContain("connect-src 'self' https://tiles.openfreemap.org");
    expect(publicCsp).not.toContain("nonce-");
    const privateCsp = (await request.get("/cuenta", { maxRedirects: 0 })).headers()["content-security-policy"];
    expect(privateCsp).toContain("nonce-");
  });
});
