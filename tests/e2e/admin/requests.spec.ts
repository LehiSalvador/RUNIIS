import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { LOCAL_DB_ONLY, psql } from "../support/account";
import { scanForSeriousViolations } from "../support/axe";
import { e2eEnv } from "../support/env";
import { expect, gotoAndSettle, signInAs, test as base } from "./support";
import { seedRequests, type SeededRequests } from "./requests-support";

/**
 * External request queue and participant administration (P3-G): every outcome comes from the real server against fixtures written by
 * requests-support.ts. Needs the local stack (Docker DB, Mailpit) like the other admin specs. Screens and the axe summary go to the
 * unit's own evidence folder.
 */
const SHOTS = ".salvaops-agent-evidence/P3-G-requests-participants-bulkcancel/screens";
mkdirSync(SHOTS, { recursive: true });

const test = base.extend<{ shot: (name: string) => Promise<void>; a11y: () => Promise<void> }>({
  shot: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}--${name}.png`, animations: "disabled" });
    });
  },
  a11y: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async () => {
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      // a row scrolled under the sticky mobile header is momentarily obscured (target-size): scan from the top of the page
      await page.evaluate(() => window.scrollTo(0, 0));
      const { results, serious } = await scanForSeriousViolations(page);
      // raw material of axe-summary.md: every violation id by impact, per screen, so "no serious/critical" is checkable and the rest is visible
      appendFileSync(
        `${SHOTS}/../axe-raw.ndjson`,
        `${JSON.stringify({
          project: testInfo.project.name,
          test: testInfo.title,
          path: new URL(page.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id"),
          passes: results.passes.length,
          violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
        })}
`,
      );
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  },
});

test.describe.configure({ mode: "serial", timeout: 150_000 });
test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);

let seed: SeededRequests;
test.beforeAll(() => {
  seed = seedRequests();
});

// ---- helpers -----------------------------------------------------------------------------------------------------------------

const queue = () => `/admin/eventos/${seed.editionId}/solicitudes`;
const people = (editionId = seed.editionId) => `/admin/eventos/${editionId}/participantes`;

async function openQueue(page: Page, query = "") {
  // settled = hydrated: a click before hydration would be lost
  await gotoAndSettle(page, `${queue()}${query}`);
  await expect(page.getByRole("heading", { level: 1, name: /^Solicitudes/ })).toBeVisible();
  await expect(page.getByTestId("bulk-bar")).toBeVisible();
}

/** Below md a DataTable keeps its row actions in the row's detail disclosure: open it when it is there. */
async function expandRow(page: Page, label: string) {
  const disclosure = page.getByRole("button", { name: `Ver detalle de ${label}`, exact: true });
  if (await disclosure.isVisible()) await disclosure.click();
}

async function requestRow(page: Page, reference: string): Promise<Locator> {
  const row = page.getByRole("row").filter({ hasText: reference }).first();
  await expect(row).toBeVisible();
  return row;
}

async function statusOf(page: Page, reference: string): Promise<string> {
  const response = await page.request.get(`/api/v1/admin/editions/${seed.editionId}/registration-requests?search=${encodeURIComponent(reference)}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.data[0].effective_status as string;
}

function dbStatus(requestId: string): string {
  return psql(`select status from app.registration_request where registration_request_id = '${requestId}'`);
}

async function openParticipant(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Buscar", { exact: true }).fill(name);
  await page.getByLabel("Buscar", { exact: true }).press("Enter");
  // the list is re-read for the new query: wait for it (an Edition with one participant already says "1 participante")
  await expect(page).toHaveURL(/search=/);
  await expect(page.getByRole("status").filter({ hasText: /1 participante/ })).toBeVisible();
  await expandRow(page, name);
  await page.getByRole("button", { name: `Detalle de ${name}`, exact: true }).click();
  await expect(page.getByTestId("participant-detail")).toBeVisible();
}

// ---- Access ------------------------------------------------------------------------------------------------------------------

test.describe("access", () => {
  test("anonymous visitors are redirected to sign in, a malformed id is not found, CHECKIN is refused", async ({ page, browser }) => {
    const anonymous = await browser.newContext();
    const anonPage = await anonymous.newPage();
    const response = await anonPage.goto(`${queue()}`, { waitUntil: "commit" });
    expect(new URL(anonPage.url()).pathname).toBe("/entrar");
    expect(response?.status()).toBeLessThan(400);
    await anonymous.close();

    await signInAs(page, "operator");
    await page.goto("/admin/eventos/not-an-edition/solicitudes");
    await expect(page.getByText("No encontramos", { exact: false }).first()).toBeVisible();
    await page.goto("/admin/eventos/not-an-edition/participantes");
    await expect(page.getByText("No encontramos", { exact: false }).first()).toBeVisible();

    await page.context().clearCookies();
    await signInAs(page, "checkin");
    await page.goto(queue());
    await expect(page.getByRole("heading", { name: "Acceso restringido" })).toBeVisible();
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
    await page.goto(people());
    await expect(page.getByRole("heading", { name: "Acceso restringido" })).toBeVisible();
    // the API is the authority: the same role is refused there too
    expect((await page.request.get(`/api/v1/admin/editions/${seed.editionId}/registration-requests`)).status()).toBe(403);
    expect((await page.request.get(`/api/v1/admin/editions/${seed.editionId}/participants`)).status()).toBe(403);
  });
});

// ---- Request queue -----------------------------------------------------------------------------------------------------------

test.describe("request queue (OPERATOR)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "operator");
  });

  test("lists the requests with the effective expiry, never as paid, and the confirmed one is not selectable", async ({ page, shot, a11y }) => {
    await openQueue(page);
    const pending = await requestRow(page, seed.requests.confirm.reference);
    await expandRow(page, seed.requests.confirm.reference);
    const detail = page.getByRole("row").filter({ hasText: seed.requests.confirm.reference });
    await expect(detail.first()).toContainText("Pendiente de confirmar");
    await expect(pending).toBeVisible();

    // expired in the clock but still PENDING_CONFIRMATION in the database: the queue reads it as expired and says the system has not caught up
    // (the expiry job may materialise it at any moment: the queue must read it as expired either way)
    const storedStatus = dbStatus(seed.requests.expired.requestId);
    expect(["PENDING_CONFIRMATION", "EXPIRED"]).toContain(storedStatus);
    await requestRow(page, seed.requests.expired.reference);
    await expandRow(page, seed.requests.expired.reference);
    const expiredRows = page.getByRole("row").filter({ hasText: seed.requests.expired.reference });
    await expect(expiredRows.first()).toContainText("Expirada");
    await expect(expiredRows.first()).toContainText("Revalidar y confirmar");
    if (storedStatus === "PENDING_CONFIRMATION") await expect(expiredRows.first()).toContainText("El sistema aún no la marca como expirada");

    // a request that is already CONFIRMED can be neither selected for bulk cancel nor cancelled or confirmed again
    const confirmedBox = page.getByRole("checkbox", { name: new RegExp(`${seed.requests.confirmed.reference}: no se puede cancelar en lote`) });
    await expect(confirmedBox).toBeDisabled();
    await expect(page.getByRole("button", { name: `Confirmar ${seed.requests.confirmed.reference}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Cancelar ${seed.requests.confirmed.reference}` })).toHaveCount(0);

    // dense table, no horizontal scroll at the three viewports (below lg the rest of the columns live in the row detail)
    const overflow = await page.evaluate(() => {
      const container = document.querySelector("table")?.parentElement;
      return container ? container.scrollWidth - container.clientWidth : -1;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // nothing in the queue says "pagado"
    await expect(page.locator("main")).not.toContainText(/pagad[oa]/i);
    await shot("queue");
    await a11y();
  });

  test("a pending request counts down on the server's clock and shows the absolute expiry in the Edition zone", async ({ page }) => {
    await openQueue(page, `?search=${seed.requests.confirm.reference}`);
    await expandRow(page, seed.requests.confirm.reference);
    const row = page.getByRole("row").filter({ hasText: seed.requests.confirm.reference }).first();
    await expect(row.getByTestId("countdown").first()).toContainText(/Quedan \d+ (h|min)/);
    await expect(row).toContainText(/Vence \d{1,2} \w+/);
    // the page states the zone the hours are in
    await expect(page.getByText(/Las horas están en la zona de la edición \(America\/Monterrey\)/)).toBeVisible();
  });

  test("the hold-concentration alert links to the affected request and nothing is cancelled automatically", async ({ page, shot, a11y }) => {
    await openQueue(page);
    // the projection may already have been computed by the 5-minute job: either way the button recomputes it from the server
    await page.getByRole("button", { name: "Recalcular alerta" }).click();
    const alert = page.getByTestId("hold-alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Nada se cancela automáticamente");
    const link = alert.getByRole("link", { name: new RegExp(seed.requests.hoarder.reference) });
    await expect(link).toBeVisible();
    await shot("hold-alert");
    await a11y();

    await link.click();
    await expect(page).toHaveURL(/status=PENDING_CONFIRMATION/);
    await expect(page.getByRole("row").filter({ hasText: seed.requests.hoarder.reference }).first()).toBeVisible();
    // the alert never touched the request
    expect(dbStatus(seed.requests.hoarder.requestId)).toBe("PENDING_CONFIRMATION");
  });

  test("the queue and the participants load without console errors or hydration warnings", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 200)}`);
    });
    await openQueue(page);
    // let the one-second clock tick a few times: a clock that disagrees with the server render would warn here
    await page.waitForTimeout(2500);
    await gotoAndSettle(page, people());
    await expect(page.getByRole("heading", { level: 1, name: /^Participantes/ })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("the queue is operable by keyboard: a command opens from Enter, Escape closes it and focus comes back", async ({ page }) => {
    await openQueue(page, `?search=${seed.requests.legal.reference}`);
    await requestRow(page, seed.requests.legal.reference);
    await expandRow(page, seed.requests.legal.reference);
    const confirm = page.getByRole("button", { name: `Confirmar ${seed.requests.legal.reference}` });
    await confirm.focus();
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Confirmar solicitud" })).toBeVisible();
    // focus is trapped inside the dialog
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(confirm).toBeFocused();
    // the quick look opens from the reference and closes with Escape too
    await page.getByRole("button", { name: `Detalle de ${seed.requests.legal.reference}`, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("request-detail")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("request-detail")).toHaveCount(0);
  });

  test("a request with a pending acceptance says so, and confirming it is refused with the reason and a support reference", async ({ page, shot }) => {
    await openQueue(page, `?search=${seed.requests.legal.reference}`);
    const row = await requestRow(page, seed.requests.legal.reference);
    await expect(row).toContainText("Pendiente de aceptación de");
    await expandRow(page, seed.requests.legal.reference);
    await page.getByRole("button", { name: `Confirmar ${seed.requests.legal.reference}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Confirmar solicitud" }).click();
    await expect(dialog.getByTestId("request-failure")).toContainText("Falta la aceptación de términos");
    await expect(dialog.getByTestId("request-failure")).toContainText(seed.requests.legal.guestNames[0]);
    await expect(dialog.getByTestId("error-reference").locator("code")).toHaveText(/\S+/);
    await shot("confirm-refused-legal");
    await dialog.getByRole("button", { name: "Cerrar" }).first().click();
    expect(dbStatus(seed.requests.legal.requestId)).toBe("PENDING_CONFIRMATION");
  });

  test("the quick look lists every participant and the buyer's WhatsApp contact", async ({ page, shot, a11y }) => {
    await openQueue(page, `?search=${seed.requests.cancel.reference}`);
    await requestRow(page, seed.requests.cancel.reference);
    await expandRow(page, seed.requests.cancel.reference);
    await page.getByRole("button", { name: `Detalle de ${seed.requests.cancel.reference}`, exact: true }).click();
    const detail = page.getByTestId("request-detail");
    await expect(detail).toBeVisible();
    for (const name of seed.requests.cancel.guestNames) await expect(detail.getByTestId("request-participants")).toContainText(name);
    await expect(detail).toContainText(seed.requests.cancel.buyerName);
    await expect(detail.getByRole("link", { name: /Escribir al comprador por WhatsApp/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+$/);
    await expect(detail).toContainText("WhatsApp de la edición");
    await shot("request-detail");
    await a11y();
  });

  test("confirming a pending request creates the registration only after the server answers", async ({ page, shot }) => {
    await openQueue(page, `?search=${seed.requests.confirm.reference}`);
    await requestRow(page, seed.requests.confirm.reference);
    await expandRow(page, seed.requests.confirm.reference);
    await page.getByRole("button", { name: `Confirmar ${seed.requests.confirm.reference}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("aún sin pago confirmado");
    await shot("confirm-dialog");
    await dialog.getByRole("button", { name: "Confirmar solicitud" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => statusOf(page, seed.requests.confirm.reference)).toBe("CONFIRMED");
    const row = await requestRow(page, seed.requests.confirm.reference);
    await expect(row).toContainText("Confirmada");
    // the registration exists, with its pass
    const registrations = psql(`select count(*) from app.registration where registration_request_id = '${seed.requests.confirm.requestId}'`);
    expect(registrations).toBe("1");
  });

  test("an expired request is revalidated; a changed price needs an explicit second decision", async ({ page, shot }) => {
    await openQueue(page, `?search=${seed.requests.expired.reference}`);
    await requestRow(page, seed.requests.expired.reference);
    await expandRow(page, seed.requests.expired.reference);
    await page.getByRole("button", { name: `Revalidar y confirmar ${seed.requests.expired.reference}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Revalidar y confirmar" }).click();
    const change = dialog.getByTestId("price-change");
    await expect(change).toContainText("El precio cambió");
    await expect(change).toContainText("$300");
    await expect(change).toContainText("$350");
    await expect(dialog.getByTestId("request-failure")).toContainText("Coordina con el comprador");
    // still not confirmed: the server refused
    expect(dbStatus(seed.requests.expired.requestId)).not.toBe("CONFIRMED");
    await shot("price-changed");
    await dialog.getByRole("button", { name: /Confirmar con el precio vigente/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => statusOf(page, seed.requests.expired.reference)).toBe("CONFIRMED");
    const row = await requestRow(page, seed.requests.expired.reference);
    await expect(row).toContainText("Confirmada");
  });

  test("cancelling one request needs a reason, releases the places and shows the result", async ({ page }) => {
    await openQueue(page, `?search=${seed.requests.cancel.reference}`);
    await requestRow(page, seed.requests.cancel.reference);
    await expandRow(page, seed.requests.cancel.reference);
    await page.getByRole("button", { name: `Cancelar ${seed.requests.cancel.reference}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("No se envía correo al comprador");
    await expect(dialog.getByRole("button", { name: "Cancelar solicitud" })).toBeDisabled();
    await dialog.getByLabel(/Motivo \(interno\)/).fill("Comprobante falso");
    await dialog.getByRole("button", { name: "Cancelar solicitud" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => statusOf(page, seed.requests.cancel.reference)).toBe("CANCELED_BY_STAFF");
    expect(psql(`select count(*) from app.registration_hold where registration_request_id = '${seed.requests.cancel.requestId}' and status = 'ACTIVE'`)).toBe("0");
  });

  test("bulk cancel: explicit selection, the count and places, a reason, a 429 retried with the same key, then per-request results", async ({ page, shot, a11y }) => {
    await openQueue(page, "?status=PENDING_CONFIRMATION");
    const a = seed.requests.bulkA.reference;
    const b = seed.requests.bulkB.reference;
    await requestRow(page, a);
    await page.getByRole("checkbox", { name: `Seleccionar ${a}` }).click();
    await page.getByRole("checkbox", { name: `Seleccionar ${b}` }).click();
    await expect(page.getByTestId("selection-summary")).toContainText("2 solicitudes elegidas · 3 lugares");
    await page.getByRole("button", { name: /Cancelar seleccionadas \(2\)/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("bulk-count")).toContainText("Se cancelarán 2 solicitudes · 3 lugares se liberan");
    await expect(dialog).toContainText("no envía correo al comprador");
    await shot("bulk-confirm");
    await a11y();
    // the reason is required
    await dialog.getByRole("button", { name: "Cancelar 2 solicitudes" }).click();
    await expect(dialog.getByText("Escribe el motivo")).toBeVisible();
    await dialog.getByLabel(/Motivo \(interno\)/).fill("Cuentas nuevas apartando en bloque");

    // the first attempt hits the per-staff mutation limit: shown as "wait", retried with the SAME Idempotency-Key
    const keys: string[] = [];
    let first = true;
    await page.route("**/registration-requests/bulk-cancel", async (route) => {
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      if (first) {
        first = false;
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "x", request_id: "req-test-429", details: { retry_after_seconds: 3 } } }),
        });
      } else {
        await route.continue();
      }
    });
    await dialog.getByRole("button", { name: "Cancelar 2 solicitudes" }).click();
    const failure = dialog.getByTestId("request-failure");
    await expect(failure).toContainText("Demasiadas acciones");
    await expect(failure).toContainText("espera un momento");
    await shot("bulk-rate-limited");
    expect(dbStatus(seed.requests.bulkA.requestId)).toBe("PENDING_CONFIRMATION");
    await failure.getByRole("button", { name: "Reintentar" }).click();
    await expect(dialog.getByTestId("bulk-summary")).toContainText("2 canceladas de 2");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await page.unroute("**/registration-requests/bulk-cancel");

    const results = dialog.getByTestId("bulk-results");
    await expect(results).toContainText(a);
    await expect(results).toContainText(b);
    await expect(results.getByText("Cancelada", { exact: true })).toHaveCount(2);
    await shot("bulk-results");
    await dialog.getByRole("button", { name: "Listo" }).click();
    await expect.poll(() => statusOf(page, a)).toBe("CANCELED_BY_STAFF");
    expect(await statusOf(page, b)).toBe("CANCELED_BY_STAFF");
    expect(psql(`select count(*) from app.registration_hold where registration_request_id in ('${seed.requests.bulkA.requestId}','${seed.requests.bulkB.requestId}') and status = 'ACTIVE'`)).toBe("0");
    // the selection does not outlive the rows
    await expect(page.getByTestId("selection-summary")).not.toContainText("elegidas");
  });

  test("bulk cancel reports a partial result and clears the alert once the hoarding request is gone", async ({ page, shot }) => {
    await openQueue(page, "?status=PENDING_CONFIRMATION");
    const c = seed.requests.bulkC.reference;
    const hoarder = seed.requests.hoarder.reference;
    await requestRow(page, c);
    await page.getByRole("checkbox", { name: `Seleccionar ${c}` }).click();
    await page.getByRole("checkbox", { name: `Seleccionar ${hoarder}` }).click();
    await expect(page.getByTestId("selection-summary")).toContainText("2 solicitudes elegidas · 11 lugares");

    // somebody else cancels one of them first: the page is now stale, the server must say so per request
    const key = `p3g-partial-${seed.suffix}`;
    const other = await page.request.post(`/api/v1/admin/registration-requests/${seed.requests.bulkC.requestId}/cancel`, {
      data: { reason: "Cancelada por otro operador" },
      headers: { "idempotency-key": key },
    });
    expect(other.status()).toBe(200);

    await page.getByRole("button", { name: /Cancelar seleccionadas \(2\)/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Motivo \(interno\)/).fill("Acaparamiento confirmado por el equipo");
    await dialog.getByRole("button", { name: "Cancelar 2 solicitudes" }).click();
    await expect(dialog.getByTestId("bulk-summary")).toContainText("1 cancelada, 1 ya estaba cancelada de 2");
    const results = dialog.getByTestId("bulk-results");
    await expect(results.getByText("Cancelada", { exact: true })).toHaveCount(1);
    await expect(results.getByText("Ya estaba cancelada")).toHaveCount(1);
    await shot("bulk-partial");
    await dialog.getByRole("button", { name: "Listo" }).click();
    expect(dbStatus(seed.requests.hoarder.requestId)).toBe("CANCELED_BY_STAFF");

    // the alert recomputes from the server and clears: the condition no longer holds
    await page.getByRole("button", { name: "Recalcular alerta" }).click();
    await expect(page.getByTestId("hold-alert-none")).toBeVisible();
  });
});

// ---- Participants ------------------------------------------------------------------------------------------------------------

test.describe("participants (OPERATOR: no PII)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, "operator");
  });

  test("lists confirmed participants, searches by pass code and shows no contact data or export", async ({ page, shot, a11y }) => {
    await page.goto(people());
    await expect(page.getByRole("heading", { level: 1, name: /^Participantes/ })).toBeVisible();
    const queued = seed.participants.queued;
    await expect(page.getByRole("row").filter({ hasText: queued.number }).first()).toBeVisible();
    // an OPERATOR holds no PII export permission: no contact column, no export button
    await expect(page.getByRole("columnheader", { name: "Contacto" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Exportar CSV" })).toHaveCount(0);
    await shot("participants");
    await a11y();

    await page.getByLabel("Buscar", { exact: true }).fill(queued.code);
    await page.getByLabel("Buscar", { exact: true }).press("Enter");
    await expect(page).toHaveURL(new RegExp(`search=${queued.code}`));
    await expect(page.getByRole("status").filter({ hasText: /1 participante/ })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: queued.number })).toHaveCount(1);
    // the API agrees: no contact block was ever sent to this role
    const api = await page.request.get(`/api/v1/admin/editions/${seed.editionId}/participants?search=${queued.code}`);
    const body = await api.json();
    expect(body.meta.contact_visible).toBe(false);
    expect(body.data[0].contact).toBeNull();
    // and the export refuses the role
    expect((await page.request.get(`/api/v1/admin/editions/${seed.editionId}/participants/export.csv?reason=prueba`)).status()).toBe(403);
  });

  test("cancel registration: the owner's rules are stated, the category and reason are required, the email outcome is shown", async ({ page, shot, a11y }) => {
    const target = seed.participants.queued;
    await page.goto(people());
    await openParticipant(page, target.name);
    await shot("participant-detail");
    await a11y();
    await page.getByRole("button", { name: "Cancelar inscripción" }).first().click();
    const dialog = page.getByRole("dialog").last();
    const notice = dialog.getByTestId("own04-notice");
    await expect(notice).toContainText("Se enviará un correo al comprador");
    await expect(notice).toContainText("no procesa ningún reembolso");
    await expect(notice).toContainText("no se envía");
    await shot("cancel-dialog");
    await a11y();

    await dialog.getByRole("button", { name: "Cancelar inscripción" }).click();
    await expect(dialog.getByText("Elige la categoría")).toBeVisible();
    await expect(dialog.getByText("Escribe el motivo interno")).toBeVisible();
    expect(psql(`select status from app.registration where registration_id = '${target.registrationId}'`)).toBe("CONFIRMED");

    await dialog.getByLabel(/Categoría del motivo/).selectOption("DUPLICATE_REGISTRATION");
    await dialog.getByLabel(/Motivo interno/).fill("Se inscribió dos veces");
    await dialog.getByRole("button", { name: "Cancelar inscripción" }).click();
    const outcome = dialog.getByTestId("cancel-outcome");
    await expect(outcome).toContainText("quedó cancelada");
    await expect(outcome.getByTestId("notification-queued")).toContainText("Correo en cola");
    await expect(outcome).toContainText("No se procesó ningún reembolso");
    await shot("cancel-outcome-queued");
    expect(psql(`select status from app.registration where registration_id = '${target.registrationId}'`)).toBe("CANCELED");
    expect(psql(`select cancel_reason from app.registration where registration_id = '${target.registrationId}'`)).toContain("Se inscribió dos veces");
    await dialog.getByRole("button", { name: "Listo" }).click();
  });

  test("cancel registration without an email contact opens a follow-up task and says so", async ({ page, shot }) => {
    const target = seed.participants.noContact;
    await page.goto(people());
    await openParticipant(page, target.name);
    await page.getByRole("button", { name: "Cancelar inscripción" }).first().click();
    const dialog = page.getByRole("dialog").last();
    await dialog.getByLabel(/Categoría del motivo/).selectOption("PARTICIPANT_REQUEST");
    await dialog.getByLabel(/Motivo interno/).fill("Lo pidió por WhatsApp");
    await dialog.getByRole("button", { name: "Cancelar inscripción" }).click();
    const outcome = dialog.getByTestId("notification-no_contact");
    await expect(outcome).toContainText("No hay correo al que avisar");
    const taskId = (await dialog.getByTestId("follow-up-task").textContent())?.trim() ?? "";
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(psql(`select task_key from app.admin_task where admin_task_id = '${taskId}'`)).toBe(`registration-cancel-notice:${target.registrationId}`);
    await shot("cancel-outcome-no-contact");
  });

  test("cancel registration with a suppressed contact says the email will not go out", async ({ page }) => {
    const target = seed.participants.suppressed;
    await page.goto(people());
    await openParticipant(page, target.name);
    await page.getByRole("button", { name: "Cancelar inscripción" }).first().click();
    const dialog = page.getByRole("dialog").last();
    await dialog.getByLabel(/Categoría del motivo/).selectOption("ADMINISTRATIVE");
    await dialog.getByLabel(/Motivo interno/).fill("Ajuste administrativo");
    await dialog.getByRole("button", { name: "Cancelar inscripción" }).click();
    await expect(dialog.getByTestId("notification-suppressed")).toContainText("El correo no se enviará");
    await expect(dialog.getByTestId("follow-up-task")).toHaveText(/^[0-9a-f-]{36}$/);
  });

  test("cancel registration after attendance was finalized explains the reopen path with the support reference", async ({ page, shot }) => {
    const target = seed.participants.blocked;
    await page.goto(people(seed.finalizedEditionId));
    await openParticipant(page, target.name);
    await page.getByRole("button", { name: "Cancelar inscripción" }).first().click();
    const dialog = page.getByRole("dialog").last();
    await dialog.getByLabel(/Categoría del motivo/).selectOption("EVENT_CHANGE");
    await dialog.getByLabel(/Motivo interno/).fill("Prueba de cierre");
    await dialog.getByRole("button", { name: "Cancelar inscripción" }).click();
    const failure = dialog.getByTestId("cancel-failure");
    await expect(failure).toContainText("La asistencia ya está finalizada");
    await expect(failure).toContainText("reabrir primero la finalización");
    await expect(failure).toContainText(/Referencia:/);
    await shot("cancel-blocked");
    expect(psql(`select status from app.registration where registration_id = '${target.registrationId}'`)).toBe("CONFIRMED");
  });

  test("change modality: the new modality is validated by the server and the distance impact is shown", async ({ page, shot, a11y }) => {
    const target = seed.participants.change;
    await page.goto(people());
    await openParticipant(page, target.name);
    await page.getByRole("button", { name: "Cambiar modalidad" }).click();
    const dialog = page.getByRole("dialog").last();
    await expect(dialog.getByLabel("Modalidad nueva").locator("option", { hasText: "10K" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cambiar modalidad" }).click();
    await expect(dialog.getByText("Elige la modalidad nueva.")).toBeVisible();
    await expect(dialog.getByText("Escribe el motivo")).toBeVisible();
    await shot("change-dialog");
    await a11y();

    // a full modality is refused by the server with the capacity message
    await dialog.getByLabel("Modalidad nueva").selectOption({ label: "5K" });
    await dialog.getByLabel("Motivo").fill("Prueba de cupo");
    await dialog.getByRole("button", { name: "Cambiar modalidad" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Sin cupo en la modalidad" })).toBeVisible();
    expect(psql(`select modality_id from app.registration where registration_id = '${target.registrationId}'`)).toBe(seed.modality10Id);

    await dialog.getByLabel("Modalidad nueva").selectOption({ label: "21K" });
    await dialog.getByLabel("Motivo").fill("Quiere correr más distancia");
    await dialog.getByRole("button", { name: "Cambiar modalidad" }).click();
    const outcome = dialog.getByTestId("change-outcome");
    await expect(outcome).toContainText("ahora está en 21K");
    await expect(outcome.getByTestId("distance-impact")).toContainText("10 km");
    await expect(outcome.getByTestId("distance-impact")).toContainText("21.097 km");
    await shot("change-outcome");
    expect(psql(`select modality_id from app.registration where registration_id = '${target.registrationId}'`)).toBe(seed.modality21Id);
    await dialog.getByRole("button", { name: "Listo" }).click();
  });
});

test.describe("participants (ADMIN: PII)", () => {
  test("contact data and the CSV export appear only for the role the API allows, and the export needs a reason", async ({ page, shot }) => {
    await signInAs(page, "admin");
    await page.goto(people());
    await expect(page.getByRole("heading", { level: 1, name: /^Participantes/ })).toBeVisible();
    const target = seed.participants.full;
    // the table shows the contact column from lg; the API said this role may see it
    if ((page.viewportSize()?.width ?? 0) >= 1024) await expect(page.getByRole("columnheader", { name: "Contacto" })).toBeVisible();
    // the contact block is in the quick look at every width (the table column only shows from lg)
    await openParticipant(page, target.name);
    const detail = page.getByTestId("participant-detail");
    await expect(detail).toContainText("+528110005003");
    await expect(detail).toContainText("Contacto de emergencia");
    await shot("participants-admin");
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);

    await page.getByRole("button", { name: "Exportar CSV" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Descargar CSV" }).click();
    await expect(dialog.getByText("Escribe por qué exportas")).toBeVisible();
    await dialog.getByLabel("Motivo de la exportación").fill("Lista de apoyo para la mesa de registro");
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Descargar CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^participants-qa-requests-.*\.csv$/);
    const path = await file.path();
    const text = readFileSync(path, "utf8");
    expect(text).toContain("registration_number");
    expect(text).toContain(target.number);
  });
});
