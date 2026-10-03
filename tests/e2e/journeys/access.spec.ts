import type { Page } from "@playwright/test";
import { createReadyUser } from "../support/account";
import { settleNetwork } from "../support/settle";
import { focusRingVisible } from "../support/fixtures";
import {
  acceptEventDocuments,
  continueButton,
  expect,
  fillDetails,
  hasHorizontalOverflow,
  openRegistration,
  requestData,
  skipWithoutFixtureAdmin,
  submitAndWait,
  tabTo,
  test,
  waitForHydration,
} from "../support/journey";

// Phase 2 participant journeys (Roadmap 8.22), part 6: how the registration is operated.
// Mobile: a full registration at 390 px (pinned here whatever the project) with no horizontal scroll and usable targets.
// Keyboard-only: a full registration with Tab / Shift+Tab / Space / Enter / arrows / Escape only, no pointer.
test.describe.configure({ timeout: 300_000 });
test.beforeEach(() => skipWithoutFixtureAdmin());

async function noOverflow(page: Page, where: string) {
  expect(await hasHorizontalOverflow(page), `horizontal scroll on ${where}`).toBe(false);
}

/** Every interactive control of the current view is at least 24x24 CSS px (WCAG 2.2 target size) and in the viewport horizontally. */
async function targetsUsable(page: Page, where: string) {
  const small = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>("main button, main [role='checkbox'], main [role='radio'], main [role='combobox'], main input:not([type='hidden'])"));
    return controls
      // The native input behind a custom checkbox/radio is a hidden form mirror (aria-hidden, no pointer events), not a target.
      .filter((el) => el.offsetParent !== null && el.getAttribute("aria-hidden") !== "true" && getComputedStyle(el).pointerEvents !== "none" && getComputedStyle(el).opacity !== "0")
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 24 || box.height < 24 || box.right > window.innerWidth + 1 || box.left < -1))
      .map(({ el, box }) => `${el.tagName.toLowerCase()}[${el.getAttribute("role") ?? el.getAttribute("type") ?? ""}] ${Math.round(box.width)}x${Math.round(box.height)} @${Math.round(box.left)}`);
  });
  expect(small, `controls below 24x24 or outside the viewport on ${where}`).toEqual([]);
}

test.describe("Mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("a full FREE registration at 390 px: no horizontal scroll, usable targets, the result and the pass reachable", async ({ page, world, a11y, evidence }) => {
    const edition = await world.edition("free");
    const user = await createReadyUser(page, "mobile");

    await openRegistration(page, edition.slug);
    await noOverflow(page, "participants");
    await targetsUsable(page, "participants");
    await a11y();
    await evidence("mobile-1-participantes");
    // The primary action is a full-width, thumb-sized button.
    const next = await continueButton(page).boundingBox();
    expect(next!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("checkbox", { name: /\(tú\)/ })).toHaveAttribute("aria-checked", "true");
    await continueButton(page).tap();

    await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
    await fillDetails(page, null, { modality: /^5K/, shirt: "M", club: "Club Móvil" });
    await noOverflow(page, "details");
    await targetsUsable(page, "details");
    await a11y();
    await evidence("mobile-2-datos");
    await continueButton(page).tap();

    await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();
    await acceptEventDocuments(page, user.name);
    await noOverflow(page, "legal");
    await targetsUsable(page, "legal");
    await a11y();
    await evidence("mobile-3-legal");
    await continueButton(page).tap();

    await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
    await noOverflow(page, "review");
    await a11y();
    await evidence("mobile-4-revision");
    const request = await requestData(await submitAndWait(page, "FREE"));
    expect(request.status).toBe("CONFIRMED");

    await expect(page.getByRole("heading", { name: /Tu inscripción está confirmada/ })).toBeVisible();
    await noOverflow(page, "result");
    await a11y();
    await evidence("mobile-5-resultado");
    await page.getByRole("link", { name: "Ver mis pases" }).tap();
    await expect(page).toHaveURL(/\/cuenta\/pases$/);
    await settleNetwork(page);
    await noOverflow(page, "passes");
    await expect(page.getByTestId("pass-row").first()).toHaveAttribute("data-pass-state", "VALID");
  });

  test("the WhatsApp hold at 390 px: countdown, handoff and cancel stay inside the screen", async ({ page, world, a11y, evidence }) => {
    const edition = await world.edition("wa");
    await createReadyUser(page, "mobilewa");
    await registerWhatsApp(page, edition.slug);

    await expect(page.getByRole("heading", { name: "Tus lugares están apartados" })).toBeVisible();
    await noOverflow(page, "hold");
    await targetsUsable(page, "hold");
    const handoff = await page.getByTestId("whatsapp-handoff").boundingBox();
    expect(handoff!.height).toBeGreaterThanOrEqual(44);
    expect(handoff!.x).toBeGreaterThanOrEqual(0);
    expect(handoff!.x + handoff!.width).toBeLessThanOrEqual(390);
    await expect(page.getByRole("timer")).toBeVisible();
    await a11y();
    await evidence("mobile-wa-apartado");
    await page.getByRole("button", { name: "Cancelar solicitud" }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await noOverflow(page, "cancel dialog");
    await a11y();
  });
});

async function registerWhatsApp(page: Page, slug: string) {
  await openRegistration(page, slug);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await fillDetails(page, null, { modality: /^5K/, shirt: "M" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();
  for (const box of await page.getByTestId("legal-card").getByRole("checkbox").all()) await box.click();
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  expect((await requestData(await submitAndWait(page, "EXTERNAL_WHATSAPP"))).status).toBe("PENDING_CONFIRMATION");
}

test("Keyboard-only: a full FREE registration with Tab, Space, Enter and arrows; focus follows every step", async ({ page, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const user = await createReadyUser(page, "keyboard");
  await page.goto(`/inscripcion/${edition.slug}`);
  await expect(page.getByRole("heading", { name: "¿Quién se inscribe?" })).toBeVisible({ timeout: 30_000 });
  await waitForHydration(page);

  // The skip link is the first stop and works.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  // Step 1: the buyer is preselected; Tab to Continuar, Enter. Focus lands on the next step's heading.
  await expect(page.getByRole("checkbox", { name: new RegExp(user.name) })).toHaveAttribute("aria-checked", "true");
  await tabTo(page, /^Continuar/);
  expect(await focusRingVisible(page)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeFocused();

  // Step 2: modality by keyboard (radio), the select with Enter + arrows, the text field typed.
  await tabTo(page, /5K/);
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: /^5K/ })).toHaveAttribute("aria-checked", "true");
  await tabTo(page, /Talla de playera/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.getByRole("combobox", { name: /Talla de playera/ })).not.toContainText("Elige");
  await tabTo(page, /Club/);
  await page.keyboard.type("Club Teclado");
  await tabTo(page, /^Continuar/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeFocused();

  // Step 3: reading a document is a dialog that traps focus and gives it back; each box is ticked with Space.
  await tabTo(page, /Leer/);
  const reader = page.locator(":focus");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(reader).toBeFocused();
  const boxes = await page.getByTestId("legal-card").filter({ hasText: user.name }).getByRole("checkbox").count();
  expect(boxes).toBeGreaterThan(0);
  for (let index = 0; index < boxes; index++) {
    await tabTo(page, /^Acepto:/);
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
  }
  await expect(page.getByTestId("legal-card").getByRole("checkbox", { checked: true })).toHaveCount(boxes);
  await tabTo(page, /^Continuar/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeFocused();
  await a11y();
  await evidence("teclado-revision");

  // Step 4: submit with Enter; the result takes focus.
  await tabTo(page, /Confirmar inscripción/);
  expect(await focusRingVisible(page)).toBe(true);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/v1/registration-requests") && response.request().method() === "POST");
  await page.keyboard.press("Enter");
  expect((await requestData(await created)).status).toBe("CONFIRMED");
  await expect(page.getByRole("heading", { name: /Tu inscripción está confirmada/ })).toBeFocused();
  await a11y();
});
