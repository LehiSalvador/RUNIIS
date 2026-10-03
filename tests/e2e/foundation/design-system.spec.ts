import { expect, focusRingVisible, test } from "../support/fixtures";
import { settleNetwork } from "../support/settle";
import { scanForSeriousViolations } from "../support/axe";

const PAGES = [
  "/",
  "/design-system",
  "/design-system/shells/account",
  "/design-system/shells/admin",
  "/design-system/shells/scanner",
] as const;

test.describe("foundation pages", () => {
  for (const path of PAGES) {
    test(`${path} renders without console errors, overflow or serious a11y violations`, async ({ page, consoleErrors }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1").first()).toBeAttached();
      await settleNetwork(page);

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, "no horizontal page scroll").toBeLessThanOrEqual(clientWidth);

      const { serious } = await scanForSeriousViolations(page);
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("design-system is noindex (meta and header)", async ({ page }) => {
    const response = await page.goto("/design-system");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});

test.describe("design-system components", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/design-system");
    await settleNetwork(page);
  });

  test("keyboard: Tab moves through controls in order and every stop shows the focus ring", async ({ page }) => {
    await page.getByRole("link", { name: "RUNIIS, ir al inicio" }).focus();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}`;
      });
      expect(seen, "focus must not revisit an element (no trap)").not.toContain(label);
      seen.push(label);
      expect(await focusRingVisible(page), `focus ring on ${label}`).toBe(true);
    }
    // DOM order == visual order for the header links, then the first buttons of the Button section.
    expect(seen.slice(0, 4).map((s) => s.split(":")[1])).toEqual([
      "Público (Home interina)",
      "Cuenta",
      "Administración",
      "Scanner",
    ]);
  });

  test("confirm modal traps focus, closes on Escape and returns focus to the trigger", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Confirmación" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "¿Marcar como no presentados?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Esto afecta a 3 participantes");

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    const { serious } = await scanForSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a Select inside a modal opens above the dialog and is operable by keyboard", async ({ page }) => {
    await page.getByRole("button", { name: "Formulario en modal" }).click();
    const dialog = page.getByRole("dialog", { name: "Verificar guardián" });
    await expect(dialog).toBeVisible();

    const trigger = dialog.getByRole("combobox", { name: "Método de verificación" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const option = page.getByRole("option", { name: "En persona con el menor" });
    await expect(option).toBeVisible();
    const onTop = await option.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop, "listbox must stack above the modal").toBe(true);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveText(/En persona con el menor|Identificación oficial/);
    await expect(dialog).toBeVisible();
  });

  test("drawer exposes a close button, keeps its footer reachable and returns focus", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Filtros" });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Filtros" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Cerrar" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Ver 12 resultados" })).toBeInViewport();
    const { serious } = await scanForSeriousViolations(page);
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

    await drawer.getByRole("button", { name: "Cerrar" }).click();
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("toasts: success auto-dismisses, errors stay until closed", async ({ page }) => {
    await page.getByRole("button", { name: "Toast error" }).click();
    const error = page.getByText("No pudimos guardar los cambios", { exact: true });
    await expect(error).toBeVisible();
    await page.getByRole("button", { name: "Toast éxito" }).click();
    const success = page.getByText("Cambios guardados", { exact: true });
    await expect(success).toBeVisible();
    await expect(success).toBeHidden({ timeout: 8000 });
    await expect(error).toBeVisible();
    await page.getByRole("button", { name: "Cerrar notificación" }).click();
    await expect(error).toBeHidden();
  });

  test("tabs: arrow keys change the tab and the Runline indicator follows", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "Periodo del ranking" });
    const first = tablist.getByRole("tab", { name: "Semanal" });
    await first.focus();
    const indicatorX = () =>
      tablist.evaluate((el) => (el.querySelector(":scope > span[aria-hidden]") as HTMLElement | null)?.style.transform ?? "");
    const before = await indicatorX();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(tablist.getByRole("tab", { name: "Mensual" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(indicatorX).not.toBe(before);
  });

  test("date input masks dd/mm/aaaa and reports impossible dates without correcting them", async ({ page }) => {
    const field = page.getByLabel("Fecha de nacimiento");
    await field.pressSequentially("29022025");
    await expect(field).toHaveValue("29/02/2025");
    await field.blur();
    await expect(page.getByText("Escribe una fecha real con el formato dd/mm/aaaa.")).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAttribute("aria-describedby", "ds-birth-error");

    await field.fill("");
    await field.pressSequentially("28022024");
    await field.blur();
    await expect(field).toHaveValue("28/02/2024");
    await expect(page.getByText("Escribe una fecha real con el formato dd/mm/aaaa.")).toBeHidden();
  });

  test("email field shows an associated error on invalid input", async ({ page }) => {
    const field = page.getByLabel("Correo");
    await field.fill("corredora");
    await field.blur();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#ds-email-error")).toHaveText(/Escribe un correo válido/);
    await field.fill("corredora@example.test");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  test("stepper: completed steps are buttons, future steps are not", async ({ page }) => {
    const stepper = page.getByRole("navigation", { name: "Progreso de inscripción" });
    await expect(stepper.getByRole("button", { name: /Paso 1 de 5: Participantes, completado/ })).toBeVisible();
    await expect(stepper.getByRole("button", { name: /Paso 3 de 5/ })).toHaveCount(0);
    await stepper.getByRole("button", { name: /Paso 1 de 5/ }).click();
    await expect(stepper.locator('[aria-current="step"]')).toContainText("Participantes");
  });

  test("countdown ticks from the server expiry and exposes a timer", async ({ page }) => {
    const timer = page.getByRole("timer").first();
    const first = await timer.textContent();
    await expect.poll(() => timer.textContent(), { timeout: 3000 }).not.toBe(first);
    await expect(page.getByText("Expirada", { exact: true })).toBeVisible();
  });

  test("QR view: loading, error with working retry, success; public code always visible", async ({ page }) => {
    await page.getByRole("button", { name: "QR cargando", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Código QR" });
    await expect(dialog.locator('[aria-busy="true"]')).toBeVisible();
    await expect(dialog.getByText("RN-8F3K-Q2")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "QR con error", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Código QR" });
    await expect(dialog.getByText("No pudimos generar tu código. Intenta de nuevo.")).toBeVisible();
    await expect(dialog.getByText("RN-8F3K-Q2")).toBeVisible();
    await dialog.getByRole("button", { name: "Reintentar" }).click();
    await expect(dialog.getByRole("img", { name: "Código QR del pase RN-8F3K-Q2" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Ver código QR", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Código QR" });
    await expect(dialog.getByRole("img", { name: "Código QR del pase RN-8F3K-Q2" })).toHaveAttribute("src", /^blob:/);
  });

  test("data table: sort is announced and selection supports select-all", async ({ page }) => {
    const table = page.getByRole("table", { name: "Participantes", exact: true });
    const nameHeader = table.getByRole("columnheader", { name: /Nombre/ });
    await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    await nameHeader.getByRole("button").click();
    await expect(nameHeader).toHaveAttribute("aria-sort", "descending");

    await table.getByRole("checkbox", { name: "Seleccionar todas las filas" }).click();
    await expect(table.getByRole("checkbox", { name: "Seleccionar Ana Torres" })).toBeChecked();
  });
});

test.describe("reduced motion", () => {
  test.use({ colorScheme: "light" });

  test("shimmer and dialog animations are neutralised", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design-system");

    const toMs = (value: string) => (value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000);
    const shimmer = await page.locator(".animate-skeleton").first().evaluate((el) => getComputedStyle(el).animationDuration);
    expect(toMs(shimmer)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Confirmación" }).click();
    const dialogAnimation = await page
      .getByRole("dialog")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(toMs(dialogAnimation)).toBeLessThanOrEqual(1);
  });
});
