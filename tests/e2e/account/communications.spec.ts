import { createReadyUser, LOCAL_DB_ONLY, seedPendingRequest } from "../support/account";
import { e2eEnv } from "../support/env";
import { hasSeededEditions, SEEDED_EDITIONS_ONLY } from "../support/targets";
import { expect, gotoAndSettle, test, unexpectedConsoleErrors } from "./support";

test.describe.configure({ timeout: 120_000 });

const OPEN_EDITION = { id: "50000000-0000-4000-8000-000000900001", name: "RUNIIS Demo Libre 5K/10K" };
const UPCOMING_EDITION = { id: "50000000-0000-4000-8000-000000900003", name: "RUNIIS Demo Próximamente" };

test("favorites and logged-in reminders, then consent toggles persist", async ({ page, a11y, evidence, consoleErrors }) => {
  test.skip(!hasSeededEditions(), SEEDED_EDITIONS_ONLY);
  await createReadyUser(page, "comms");
  await gotoAndSettle(page, "/cuenta/favoritos");
  await expect(page.getByRole("heading", { name: "No tienes carreras favoritas" })).toBeVisible();

  for (const edition of [OPEN_EDITION, UPCOMING_EDITION]) {
    expect((await page.request.post(`/api/v1/events/${edition.id}/favorite`)).status()).toBe(200);
  }
  await page.reload();
  const open = page.getByTestId("favorite-row").filter({ hasText: OPEN_EDITION.name });
  await expect(open.getByText("Inscripciones abiertas")).toBeVisible();
  // Reminders announce registration opening, so an already-open Edition offers none.
  await expect(open.getByRole("button", { name: /^Recordarme/ })).toHaveCount(0);
  const row = page.getByTestId("favorite-row").filter({ hasText: UPCOMING_EDITION.name });
  await expect(row.getByText("Próximamente", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: /^Recordarme/ }).click();
  await expect(page.getByText("Te avisaremos por correo").first()).toBeVisible();
  await expect(row.getByText("Recordatorio activo")).toBeVisible();
  await a11y();
  await evidence("favoritos");

  await gotoAndSettle(page, "/cuenta/comunicaciones");
  await expect(page.getByTestId("reminder-row").filter({ hasText: UPCOMING_EDITION.name })).toBeVisible();
  const news = page.getByRole("checkbox", { name: "Novedades de RUNIIS" });
  await expect(news).not.toBeChecked();
  await news.click();
  await expect(page.getByText("Activaste: Novedades de RUNIIS").first()).toBeVisible();
  await expect(news).toBeChecked();
  await a11y();
  await evidence("comunicaciones");

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Novedades de RUNIIS" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Novedades de RUNIIS" }).click();
  await expect(page.getByText("Desactivaste: Novedades de RUNIIS").first()).toBeVisible();

  await page.getByTestId("reminder-row").getByRole("button", { name: /^Quitar/ }).click();
  await expect(page.getByTestId("reminder-row")).toHaveCount(0);

  await gotoAndSettle(page, "/cuenta/favoritos");
  await row.getByRole("button", { name: /^Quitar RUNIIS/ }).click();
  await expect(row).toHaveCount(0);
  await open.getByRole("button", { name: /^Quitar RUNIIS/ }).click();
  await expect(page.getByRole("heading", { name: "No tienes carreras favoritas" })).toBeVisible();
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

test("reminder confirmation landing: POST on click, token stripped from the URL, generic outcomes", async ({ page, a11y, evidence, consoleErrors }) => {
  await gotoAndSettle(page, `/recordatorios/confirmar?token=${"ab".repeat(20)}`);
  await expect(page).toHaveURL(/\/recordatorios\/confirmar$/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await a11y();
  await evidence("recordatorio-confirmar");

  // Unknown token: the real API answers 410 and the page shows the generic message.
  await page.getByRole("button", { name: "Confirmar recordatorio" }).click();
  await expect(page.getByRole("heading", { name: "Este enlace ya no es válido" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Este enlace ya no es válido" })).toBeFocused();

  // Missing/malformed token never calls the API.
  await gotoAndSettle(page, "/recordatorios/confirmar?token=nope");
  await expect(page.getByRole("heading", { name: "Este enlace ya no es válido" })).toBeVisible();

  // Success rendering (the confirmation token only exists inside a real email): intercepted locally.
  await page.route("**/api/v1/reminders/confirm", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { status: "CONFIRMED", edition: { slug: "demo-libre-5k-10k", name: OPEN_EDITION.name } }, meta: {} }) }),
  );
  await gotoAndSettle(page, `/recordatorios/confirmar?token=${"cd".repeat(20)}`);
  await page.getByRole("button", { name: "Confirmar recordatorio" }).click();
  await expect(page.getByRole("heading", { name: "Listo, tu recordatorio está activo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver la carrera" })).toHaveAttribute("href", "/eventos/demo-libre-5k-10k");
  await evidence("recordatorio-confirmado");
  expect(unexpectedConsoleErrors(consoleErrors, [410])).toEqual([]);
});

test("keyboard, skip link, account nav and reduced motion", async ({ page, a11y }) => {
  test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const user = await createReadyUser(page, "kbd");
  seedPendingRequest(user.runnerProfileId, 45);
  await gotoAndSettle(page, "/cuenta");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  // Countdown keeps updating under reduced motion (informational, not decorative).
  const timer = page.getByRole("timer").first();
  const first = await timer.textContent();
  await expect.poll(async () => timer.textContent(), { timeout: 5_000 }).not.toBe(first);

  // Account navigation is reachable (sidebar on desktop, drawer below lg).
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024) {
    await page.getByRole("button", { name: "Abrir menú de cuenta" }).click();
    await expect(page.getByRole("dialog", { name: "Mi cuenta" })).toBeVisible();
    await page.getByRole("dialog").getByRole("link", { name: "Invitados" }).click();
  } else {
    await page.getByRole("navigation", { name: "Mi cuenta" }).getByRole("link", { name: "Invitados" }).click();
  }
  await expect(page).toHaveURL(/\/cuenta\/invitados$/);
  await expect(page.getByRole("heading", { level: 1, name: "Invitados" })).toBeAttached();
  await a11y();
});
