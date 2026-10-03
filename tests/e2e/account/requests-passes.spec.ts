import { createReadyUser, LOCAL_DB_ONLY, seedConfirmedWithPasses, seedPendingRequest, SEED_EDITION } from "../support/account";
import { e2eEnv } from "../support/env";
import { expect, gotoAndSettle, test, unexpectedConsoleErrors } from "./support";

test.describe.configure({ timeout: 120_000 });
test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);

test("pending request: server-time countdown, WhatsApp handoff, honest copy, cancel with confirmation", async ({ page, a11y, evidence, consoleErrors }) => {
  const user = await createReadyUser(page, "req");
  const { requestId, reference } = seedPendingRequest(user.runnerProfileId, 90);

  await gotoAndSettle(page, "/cuenta");
  const card = page.getByTestId("request-card").filter({ hasText: reference });
  await expect(card.getByText("Apartado", { exact: true })).toBeVisible();
  await expect(card.getByRole("timer")).toHaveText(/^01:(29|30):\d{2}$/);
  const whatsapp = card.getByRole("link", { name: /Completar por WhatsApp/ });
  await expect(whatsapp).toHaveAttribute("href", new RegExp(`^https://wa\\.me/528110000099\\?text=.*${reference}`));
  await expect(whatsapp).toHaveAttribute("target", "_blank");
  await expect(whatsapp).toHaveAttribute("rel", /noopener/);
  // Copy rule 1: never "pagado" before confirmation.
  await expect(page.getByText(/pagad/i)).toHaveCount(0);
  await a11y();
  await evidence("resumen-apartado");

  await gotoAndSettle(page, `/cuenta/solicitudes/${requestId}`);
  await expect(page.getByRole("heading", { level: 2, name: SEED_EDITION.name })).toBeVisible();
  await expect(page.getByTestId("request-total")).toHaveText("$350");
  await expect(page.getByTestId("request-participant")).toHaveCount(1);
  await evidence("solicitud-detalle");
  await a11y();

  await page.getByRole("button", { name: "Cancelar solicitud" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Cancelar esta solicitud?" });
  await expect(dialog).toContainText("No se puede deshacer");
  await dialog.getByLabel("Motivo (opcional)").fill("Ya no podré asistir");
  await dialog.getByRole("button", { name: "Sí, cancelar solicitud" }).click();
  await expect(page.getByText("Cancelada por ti", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar solicitud" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Completar por WhatsApp/ })).toHaveCount(0);
  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

test("expiry: effective status comes from expires_at, and a live hold flips to Expirada without reload", async ({ page, evidence }) => {
  const user = await createReadyUser(page, "exp");
  const live = seedPendingRequest(user.runnerProfileId, 0.75);

  await gotoAndSettle(page, `/cuenta/solicitudes/${live.requestId}`);
  await expect(page.getByRole("timer")).toBeVisible();
  // ~45 s hold: the countdown itself switches to the expired state, no server round trip.
  await expect(page.getByTestId("request-summary")).toContainText("El apartado venció", { timeout: 60_000 });
  await expect(page.getByRole("link", { name: /Completar por WhatsApp/ })).toHaveCount(0);

  // Reload: the server already derives EXPIRED from expires_at even though the row is still PENDING.
  await page.reload();
  await expect(page.getByText("Expirada").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar solicitud" })).toHaveCount(0);
  await evidence("solicitud-expirada");
});

test("passes: own and guest passes, QR render, retry on failure, public code fallback, no self-replace", async ({ page, a11y, evidence, consoleErrors }) => {
  const user = await createReadyUser(page, "pass");
  const { ownCode, guestCode } = seedConfirmedWithPasses(user.runnerProfileId, `Invitado Pase ${Date.now()}`);

  await gotoAndSettle(page, "/cuenta/pases");
  await expect(page.getByRole("heading", { name: "Tus pases" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pases de tus invitados" })).toBeVisible();
  const own = page.getByTestId("pass-row").filter({ hasText: ownCode });
  const guest = page.getByTestId("pass-row").filter({ hasText: guestCode });
  await expect(own.getByText("Tu pase", { exact: true })).toBeVisible();
  await expect(guest.getByText(/^Pase de Invitado Pase/)).toBeVisible();
  await expect(page.getByText(/reemplazar/i)).toHaveCount(0);
  await expect(page.getByText("¿Crees que alguien más vio tu código?")).toBeVisible();
  await a11y();
  await evidence("pases");

  // Render OK: private SVG in an <img>, public code beside it.
  await own.getByRole("button", { name: /Ver código QR/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: `Código QR del pase ${ownCode}` })).toBeVisible();
  await expect(dialog.getByText(ownCode)).toBeVisible();
  await evidence("pase-qr");
  await page.keyboard.press("Escape");
  await expect(own.getByRole("button", { name: /Ver código QR/ })).toBeFocused();

  // Forced failure (route interception on the local server): error + retry, code still visible.
  let failNext = true;
  await page.route("**/render-qr", (route) => {
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "x", request_id: "r", details: {} } }) });
    }
    return route.continue();
  });
  await guest.getByRole("button", { name: /Ver código QR/ }).click();
  await expect(dialog.getByText("No pudimos generar tu código. Intenta de nuevo.")).toBeVisible();
  await expect(dialog.getByText(guestCode)).toBeVisible();
  await evidence("pase-qr-error");
  await dialog.getByRole("button", { name: "Reintentar" }).click();
  await expect(dialog.getByRole("img", { name: `Código QR del pase ${guestCode}` })).toBeVisible();
  await page.keyboard.press("Escape");

  // Detail page.
  await own.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/cuenta\/pases\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("pass-public-code")).toHaveText(ownCode);
  await evidence("pase-detalle");

  // Someone else's / unknown pass id renders the generic not-found (streamed, so the status stays 200).
  await page.goto("/cuenta/pases/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { level: 1, name: "Esta página no existe" })).toBeVisible();
  expect(unexpectedConsoleErrors(consoleErrors, [503])).toEqual([]);
});
