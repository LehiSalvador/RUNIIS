import { expect, focusRingVisible, mockMe, test } from "../support/fixtures";
import { scanForSeriousViolations } from "../support/axe";

test.describe("public shell", () => {
  test("skip link is the first stop and moves focus into main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    expect(await focusRingVisible(page)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();
  });

  test("anonymous visitors get the Entrar chip without the page reading a session", async ({ page }) => {
    const meRequest = page.waitForRequest("**/api/v1/me");
    await page.goto("/");
    const request = await meRequest;
    expect(request.method()).toBe("GET");
    await expect(page.getByRole("banner").getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/entrar");
  });

  test("signed-in visitors get the Mi cuenta chip", async ({ page }) => {
    await page.unroute("**/api/v1/me");
    await mockMe(page, "authenticated");
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Mi cuenta" })).toHaveAttribute("href", "/cuenta");
  });

  test("mobile menu drawer lists the primary navigation", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-desktop", "desktop shows the inline nav");
    await page.goto("/");
    const menuButton = page.getByRole("button", { name: "Abrir menú" });
    if (testInfo.project.name === "chromium-tablet") {
      await expect(menuButton).toBeHidden();
      await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
      return;
    }
    await menuButton.click();
    const drawer = page.getByRole("dialog", { name: "Menú" });
    await expect(drawer.getByRole("link", { name: "Eventos" })).toBeVisible();
    const { serious } = await scanForSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(menuButton).toBeFocused();
  });

  test("hidden menu button leaves no invisible tab stop on desktop", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop only");
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Abrir menú" })).toBeHidden();
  });
});

test.describe("account and admin shells", () => {
  test("account shell: one h1, nav in sidebar (lg) or drawer (below lg)", async ({ page }, testInfo) => {
    await page.goto("/design-system/shells/account");
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeAttached();
    await expect(page.locator("h1")).toHaveCount(1);
    if (testInfo.project.name === "chromium-desktop") {
      await expect(page.getByRole("navigation", { name: "Mi cuenta" })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Abrir menú de cuenta" }).click();
      await expect(page.getByRole("dialog", { name: "Mi cuenta" }).getByRole("link", { name: "Pases" })).toBeVisible();
    }
  });

  test("admin shell renders only the RBAC-visible nav items", async ({ page }, testInfo) => {
    await page.goto("/design-system/shells/admin");
    if (testInfo.project.name === "chromium-mobile") {
      await page.getByRole("button", { name: "Abrir menú de administración" }).click();
    }
    const nav = page.getByRole("navigation", { name: "Administración" }).last();
    await expect(nav.getByRole("link", { name: "Participantes" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Auditoría" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Usuarios" })).toHaveCount(0);
  });

  test("scanner shell: manual lookup opens as a bottom drawer on the ink surface", async ({ page }) => {
    await page.goto("/design-system/shells/scanner");
    const lookup = page.getByRole("button", { name: "Búsqueda manual" });
    const glyphColor = await lookup.locator("span").first().evaluate((el) => getComputedStyle(el).color);
    expect(glyphColor, "icon must be paper on the ink surface").toBe("rgb(246, 247, 243)");
    await lookup.click();
    await expect(page.getByRole("dialog", { name: "Búsqueda manual" }).getByLabel("Número de inscripción o código público")).toBeVisible();
  });
});

test.describe("security headers", () => {
  test("baseline headers everywhere, camera only on /scanner", async ({ request }) => {
    const home = await request.get("/");
    const headers = home.headers();
    expect(headers["strict-transport-security"]).toContain("max-age=63072000");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["permissions-policy"]).toBe("camera=()");
    expect(headers["x-powered-by"]).toBeUndefined();

    const scanner = await request.get("/scanner");
    expect(scanner.headers()["permissions-policy"]).toBe("camera=(self)");
  });
});
