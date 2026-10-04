import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { LOCAL_DB_ONLY, psql } from "../support/account";
import { scanForSeriousViolations } from "../support/axe";
import { e2eEnv } from "../support/env";
import { expect as supportExpect, signInAs, signInAsNewUser, test as base } from "./support";
import { assignScopedAdmin, attendanceRow, creditCounts, currentFinalizationRevision, eligibilityRow, seedClosure, type Person, type SeededClosure } from "./closure-support";

/**
 * Attendance desk, finalization and closure (P3-I). Real server, real staff sessions, fixtures from closure-support.ts. The main journey
 * runs on one Edition in order (resolve, bulk no-show, finalize, reopen, finalize again, close, reopen the closure, close again); the refusals,
 * the roles and the large list run on their own Editions. Where a refusal cannot be produced by the real server (a lost connection, a 429, a
 * 403 for a session that looks global, a 2000-row cap) the browser-side answer is injected and the test says so.
 */
const expect = supportExpect.configure({ timeout: 45_000 });
const SHOTS = ".salvaops-agent-evidence/P3-I-attendance-finalization-closure/screens";
mkdirSync(SHOTS, { recursive: true });


const test = base.extend<{ shot: (name: string) => Promise<void>; scan: () => Promise<void> }>({
  shot: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}--${name}.png`, fullPage: true, animations: "disabled" });
    });
  },
  scan: async ({ page }, provide) => {
    await provide(async () => {
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      const { serious } = await scanForSeriousViolations(page);
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  },
});

test.describe.configure({ timeout: 240_000 });
test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);

let seed: SeededClosure;
test.beforeAll(() => {
  seed = seedClosure();
});

const desk = (id: string) => `/admin/eventos/${id}/asistencia`;
const closurePage = (id: string) => `/admin/eventos/${id}/cierre`;
const api = (id: string, tail: string) => `/api/v1/admin/editions/${id}/${tail}`;

async function openDesk(page: Page, editionId: string) {
  await page.goto(desk(editionId));
  await expect(page.getByTestId("attendance-desk")).toBeVisible();
}

async function openClosure(page: Page, editionId: string) {
  await page.goto(closurePage(editionId));
  await expect(page.getByTestId("closure-desk")).toBeVisible();
}

/** Below md a DataTable keeps its row actions in the row's detail disclosure: open it when it is there, then return the action button. */
async function rowAction(page: Page, person: Person, action: "Asistencia" | "Elegibilidad"): Promise<Locator> {
  const disclosure = page.getByRole("button", { name: `Ver detalle de ${person.name}` });
  if (await disclosure.isVisible()) await disclosure.click();
  return page.getByRole("button", { name: new RegExp(`^${action} de ${person.name}$`) });
}

async function expectStat(page: Page, key: "ALL" | "PRESENT" | "PENDING" | "NO_SHOW" | "EXCLUDED", value: number) {
  await expect(page.getByTestId(`stat-${key}-value`)).toHaveText(String(value));
}

function dialogOf(page: Page) {
  return page.getByRole("dialog").last();
}

/** POSTs the page sends to the admin API while `run` executes. */
async function watchPosts(page: Page, run: () => Promise<void>): Promise<string[]> {
  const urls: string[] = [];
  const listener = (request: { method: () => string; url: () => string }) => {
    if (request.method() === "POST" && request.url().includes("/api/v1/admin/")) urls.push(request.url());
  };
  page.on("request", listener);
  try {
    await run();
  } finally {
    page.off("request", listener);
  }
  return urls;
}

async function chooseAttendance(page: Page, person: Person, value: "PRESENT" | "NO_SHOW" | "EXCLUDED") {
  await (await rowAction(page, person, "Asistencia")).click();
  const dialog = dialogOf(page);
  await expect(dialog.getByRole("heading", { name: `Resolver asistencia de ${person.name}` })).toBeVisible();
  await dialog.getByLabel(/Resultado de asistencia/).selectOption(value);
  return dialog;
}

// ---- Main journey --------------------------------------------------------------------------------------------------------------

test.describe("attendance, finalization and closure: the main journey", () => {
  test.describe.configure({ mode: "serial" });

  test("the desk shows the universe, check-in as evidence (never as attendance) and the blocking counts", async ({ page, shot, scan }) => {
    const { flow } = seed;
    await signInAs(page, "operator");
    await openDesk(page, flow.editionId);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^Asistencia · ${flow.name}`) })).toBeVisible();

    await expectStat(page, "ALL", 7);
    await expectStat(page, "PRESENT", 2);
    await expectStat(page, "PENDING", 5);
    await expectStat(page, "NO_SHOW", 0);

    // the evidence rule is said on screen, and a check-in row says it is a pre-classification, never "final attendance"
    await expect(page.getByTestId("evidence-note")).toContainText("El check-in es evidencia de llegada, no la asistencia final");
    const checked = page.locator("tr", { hasText: flow.people.checkin.name });
    await expect(checked.locator('[data-attendance="PRESENT"][data-source="CHECKIN"]')).toContainText("Preclasificado por check-in");
    const pending = page.locator("tr", { hasText: flow.people.pend1.name });
    await expect(pending.locator('[data-attendance="PENDING"]')).toContainText("Sin resolver todavía");
    // a guest is labelled as such and never shows a credit
    await expect(page.locator("tr", { hasText: flow.people.guestCheckin.name })).toContainText("Invitado");

    // finalize mirrors the server readiness: disabled, with BOTH blocking counts as text beside it (T13 4.14)
    await expect(page.getByTestId("finalize-button")).toBeDisabled();
    await expect(page.getByTestId("finalize-blocking")).toContainText("5 inscripciones con asistencia pendiente");
    await expect(page.getByTestId("finalize-readiness")).toContainText("No queda asistencia pendiente");
    await expect(page.getByTestId("bulk-button")).toBeVisible();
    await shot("desk-open");
    await scan();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("the status tiles and the filters narrow the list; the counts stay the server's", async ({ page }) => {
    const { flow } = seed;
    await signInAs(page, "operator");
    await openDesk(page, flow.editionId);
    await page.getByTestId("stat-PENDING").click();
    await expect(page.getByTestId("stat-PENDING")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("result-summary")).toContainText("Mostrando 1–5 de 5");
    await expect(page.locator("tr", { hasText: flow.people.checkin.name })).toHaveCount(0);
    await page.getByTestId("stat-PENDING").click();
    await page.getByLabel("Buscar").fill("cuatro");
    await expect(page.getByTestId("result-summary")).toContainText("Mostrando 1–1 de 1");
    await expect(page.locator("tr", { hasText: flow.people.pend4.name })).toBeVisible();
    await page.getByRole("button", { name: "Limpiar filtros" }).click();
    await expect(page.getByTestId("result-summary")).toContainText("de 7");
    await page.getByLabel("Origen").selectOption("CHECKIN");
    await expect(page.getByTestId("result-summary")).toContainText("de 2");
    await expectStat(page, "ALL", 7); // the tiles are the Edition's counts, whatever the list shows
  });

  test("manual PRESENT needs a reason and evidence, EXCLUDED needs a reason; nothing is sent while the form is invalid", async ({ page, shot, scan }) => {
    const { flow } = seed;
    await signInAs(page, "operator");
    await openDesk(page, flow.editionId);

    const sent = await watchPosts(page, async () => {
      const dialog = await chooseAttendance(page, flow.people.pend1, "PRESENT");
      await dialog.getByRole("button", { name: "Guardar asistencia" }).click();
      await expect(dialog.getByText("Escribe por qué se cuenta como presente.")).toBeVisible();
      await expect(dialog.getByText("Elige cómo se comprobó la llegada.")).toBeVisible();
      await expect(dialog.getByText("Describe la evidencia", { exact: false })).toBeVisible();
      await shot("present-needs-evidence");
      await scan();
      await dialog.getByRole("button", { name: "Cancelar" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const excluded = await chooseAttendance(page, flow.people.pend2, "EXCLUDED");
      await excluded.getByRole("button", { name: "Guardar asistencia" }).click();
      await expect(excluded.getByText("Escribe el motivo de la exclusión.")).toBeVisible();
      await excluded.getByRole("button", { name: "Cancelar" }).click();
    });
    expect(sent).toEqual([]);
    expect(attendanceRow(flow.people.pend1.registrationId).status).toBe("PENDING");

    // PRESENT with reason + evidence
    const present = await chooseAttendance(page, flow.people.pend1, "PRESENT");
    await present.getByLabel(/Cómo se comprobó la llegada/).selectOption("DESK_VERIFICATION");
    await present.getByLabel(/^Evidencia/).fill("Visto en la mesa de llegada con su pase impreso");
    await present.getByLabel(/^Motivo/).fill("No pasó por el escáner");
    await present.getByRole("button", { name: "Guardar asistencia" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText(`${flow.people.pend1.name}: Presente (Resuelto por el staff)`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectStat(page, "PRESENT", 3);
    await expectStat(page, "PENDING", 4);
    const saved = attendanceRow(flow.people.pend1.registrationId);
    expect(saved).toMatchObject({ status: "PRESENT", source: "MANUAL", reason: "No pasó por el escáner" });
    expect(saved.evidence).toContain("DESK_VERIFICATION");

    // EXCLUDED with a reason
    const excluded = await chooseAttendance(page, flow.people.pend2, "EXCLUDED");
    await excluded.getByLabel(/^Motivo/).fill("Compitió en otra modalidad sin registrarse");
    await excluded.getByRole("button", { name: "Guardar asistencia" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("Excluido");
    await expectStat(page, "EXCLUDED", 1);
    expect(attendanceRow(flow.people.pend2.registrationId).status).toBe("EXCLUDED");

    // a check-in row can still be corrected by staff, and says so
    await (await rowAction(page, flow.people.guestCheckin, "Asistencia")).click();
    await expect(dialogOf(page).getByTestId("current-attendance")).toContainText("El check-in es evidencia de llegada");
    await dialogOf(page).getByRole("button", { name: "Cancelar" }).click();
  });

  test("eligibility: a final disqualification needs an explicit credit decision; a review leaves the credit pending and blocks finalization", async ({ page, shot }) => {
    const { flow } = seed;
    await signInAs(page, "operator");
    await openDesk(page, flow.editionId);

    await (await rowAction(page, flow.people.pend3, "Elegibilidad")).click();
    let dialog = dialogOf(page);
    await expect(dialog.getByRole("heading", { name: new RegExp(`^Elegibilidad deportiva de ${flow.people.pend3.name}`) })).toBeVisible();
    await dialog.getByLabel(/^Elegibilidad/).selectOption("DISQUALIFIED");
    await dialog.getByRole("button", { name: "Guardar elegibilidad" }).click();
    await expect(dialog.getByText("Elige si se acredita la distancia (permitir o denegar).")).toBeVisible();
    await expect(dialog.getByText("Escribe el motivo: queda en la auditoría.")).toBeVisible();
    // PENDING is never a selectable final value
    await expect(dialog.getByLabel(/Crédito de distancia/).locator('option[value="PENDING"]')).toHaveCount(0);
    await dialog.getByLabel(/Crédito de distancia/).selectOption("DENY");
    await dialog.getByLabel(/^Motivo/).fill("Atajo fuera de la ruta oficial");
    await shot("eligibility-disqualify");
    await dialog.getByRole("button", { name: "Guardar elegibilidad" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("Descalificado · Crédito denegado");
    expect(eligibilityRow(flow.people.pend3.registrationId)).toEqual({ status: "DISQUALIFIED", disposition: "DENY" });

    // a review can only carry a PENDING credit, and that blocks finalization (and the UI says so)
    await (await rowAction(page, flow.people.pend4, "Elegibilidad")).click();
    dialog = dialogOf(page);
    await dialog.getByLabel(/^Elegibilidad/).selectOption("PENDING_REVIEW");
    await expect(dialog.getByLabel(/Crédito de distancia/)).toBeDisabled();
    await expect(dialog.getByLabel(/Crédito de distancia/)).toHaveValue("PENDING");
    await dialog.getByRole("button", { name: "Guardar elegibilidad" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("En revisión · Crédito por decidir");
    await expect(page.getByTestId("finalize-blocking")).toContainText("1 crédito por decidir");
    await expect(page.getByTestId("eligibility-counts")).toContainText("1 con el crédito por decidir");

    // resolve the review again: the credit is allowed
    await (await rowAction(page, flow.people.pend4, "Elegibilidad")).click();
    dialog = dialogOf(page);
    await dialog.getByLabel(/^Elegibilidad/).selectOption("ELIGIBLE");
    await expect(dialog.getByLabel(/Crédito de distancia/)).toHaveValue("ALLOW");
    await dialog.getByRole("button", { name: "Guardar elegibilidad" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("Elegible · Crédito permitido");
    await expect(page.getByTestId("finalize-blocking")).not.toContainText("crédito por decidir");
    expect(eligibilityRow(flow.people.pend4.registrationId)).toEqual({ status: "ELIGIBLE", disposition: "ALLOW" });
  });

  test("bulk no-show: the scope confirmation lists the exact count and what is untouched, and needs a reason; cancelling changes nothing", async ({ page, shot, scan }) => {
    const { flow } = seed;
    await signInAs(page, "operator");
    await openDesk(page, flow.editionId);
    await expectStat(page, "PENDING", 3);

    await page.getByTestId("bulk-button").click();
    const dialog = dialogOf(page);
    await expect(dialog.getByRole("heading", { name: /Marcar a los pendientes como «No se presentó» y finalizar/ })).toBeVisible();
    await expect(dialog.getByTestId("command-count")).toHaveText("Afecta a 3 inscripciones pendientes.");
    await expect(dialog.getByTestId("command-consequences")).toContainText("No se toca a quienes ya están presentes (3) ni excluidos (1)");
    const confirmButton = dialog.getByRole("button", { name: "Marcar 3 y finalizar" });
    await expect(confirmButton).toBeDisabled();
    await dialog.getByLabel(/Confirmo que las 3 inscripciones pendientes no se presentaron/).check();
    await expect(confirmButton).toBeEnabled();
    const sent = await watchPosts(page, async () => {
      await confirmButton.click();
      await expect(dialog.getByText("Escribe el motivo: queda en la auditoría.")).toBeVisible();
    });
    expect(sent).toEqual([]); // the reason is required before anything is sent
    await shot("bulk-confirm");
    await scan();

    // cancel: nothing changed
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(attendanceRow(flow.people.pend3.registrationId).status).toBe("PENDING");
    expect(currentFinalizationRevision(flow.editionId)).toBeNull();

    // confirm: the pending rows become NO_SHOW, PRESENT and EXCLUDED are untouched, and the attendance is finalized
    await page.getByTestId("bulk-button").click();
    const again = dialogOf(page);
    await again.getByLabel(/^Motivo/).fill("No se presentaron a la salida ni a la meta");
    await again.getByLabel(/Confirmo que las 3 inscripciones/).check();
    await again.getByRole("button", { name: "Marcar 3 y finalizar" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("Revisión 1: 3 presentes, 3 no se presentaron, 1 excluido de 7 esperados");
    await expect(page.getByTestId("command-outcome")).toContainText("Se marcaron 3 inscripciones pendientes");
    await expect(page.getByTestId("attendance-desk")).toHaveAttribute("data-stage", "FINALIZED");
    await expectStat(page, "NO_SHOW", 3);
    await expectStat(page, "PRESENT", 3);
    await expectStat(page, "EXCLUDED", 1);
    expect(attendanceRow(flow.people.pend3.registrationId)).toMatchObject({ status: "NO_SHOW", source: "MANUAL" });
    expect(attendanceRow(flow.people.pend1.registrationId).status).toBe("PRESENT");
    expect(attendanceRow(flow.people.pend2.registrationId).status).toBe("EXCLUDED");
    expect(currentFinalizationRevision(flow.editionId)).toBe(1);
  });

  test("finalized: attendance is locked, eligibility is still open; reopening needs a reason and finalizing again is a new revision", async ({ page, shot }) => {
    const { flow } = seed;
    await signInAs(page, "operator");
    await openDesk(page, flow.editionId);
    await expect(page.getByTestId("finalization-summary")).toContainText("Revisión");
    await expect(page.getByTestId("finalization-summary")).toContainText("Primera finalización");
    // no attendance actions on a finalized Edition; the eligibility action stays until the closure
    const disclosure = page.getByRole("button", { name: `Ver detalle de ${flow.people.pend1.name}` });
    if (await disclosure.isVisible()) await disclosure.click();
    await expect(page.getByRole("button", { name: new RegExp(`^Asistencia de ${flow.people.pend1.name}$`) })).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(`^Elegibilidad de ${flow.people.pend1.name}$`) })).toBeVisible();
    await shot("finalized");

    await page.getByTestId("reopen-button").click();
    const dialog = dialogOf(page);
    await expect(dialog.getByTestId("command-consequences")).toContainText("revisión nueva");
    const sent = await watchPosts(page, async () => {
      await dialog.getByRole("button", { name: "Reabrir finalización" }).click();
      await expect(dialog.getByText("Escribe el motivo: queda en la auditoría.")).toBeVisible();
    });
    expect(sent).toEqual([]);
    await dialog.getByLabel(/Motivo de la reapertura/).fill("Corregir la asistencia de un corredor");
    await dialog.getByRole("button", { name: "Reabrir finalización" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("Finalización reabierta");
    await expect(page.getByTestId("attendance-desk")).toHaveAttribute("data-stage", "OPEN");
    expect(currentFinalizationRevision(flow.editionId)).toBeNull();
    // attendance is editable again and nothing else was lost
    await expectStat(page, "NO_SHOW", 3);
    await expect(page.getByTestId("finalize-button")).toBeEnabled();

    await page.getByTestId("finalize-button").click();
    const finalize = dialogOf(page);
    await expect(finalize.getByTestId("command-consequences")).toContainText("Se congela la asistencia de 7 inscripciones: 3 presentes, 3 no se presentaron y 1 excluidas");
    await finalize.getByRole("button", { name: "Finalizar asistencia" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("Revisión 2:");
    await expect(page.getByTestId("finalization-summary")).toContainText("Revisión 2: reemplaza una revisión anterior, sustituida");
    expect(currentFinalizationRevision(flow.editionId)).toBe(2);
  });

  test("close (global admin): the readiness and the credit summary come from the server, Guests are never credited", async ({ page, shot, scan }) => {
    const { flow } = seed;
    await signInAs(page, "admin");
    await openClosure(page, flow.editionId);
    await expect(page.getByTestId("global-only-note")).toHaveCount(0);
    await expect(page.getByTestId("closure-desk")).toHaveAttribute("data-stage", "FINALIZED");
    await expect(page.getByTestId("close-readiness")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("close-readiness").locator('[data-check="UNIVERSE_STABLE"]')).toHaveAttribute("data-ok", "true");
    // before closing: the summary says what a close could credit (PRESENT + credit allowed + runner account), and no credit exists yet
    await expect(page.getByTestId("credit-candidates")).toHaveText("2");
    await expect(page.getByTestId("credit-count")).toHaveText("0");
    await expect(page.getByTestId("credit-guests")).toHaveText("0");
    await shot("closure-ready");
    await scan();

    await page.getByTestId("close-button").click();
    const dialog = dialogOf(page);
    await expect(dialog.getByRole("heading", { name: "Cerrar la edición" })).toBeVisible();
    await expect(dialog.getByTestId("command-consequences")).toContainText("Los invitados nunca reciben crédito");
    const confirmButton = dialog.getByRole("button", { name: "Cerrar la edición" });
    await expect(confirmButton).toBeDisabled();
    await dialog.getByLabel(/Entiendo que se crearán los créditos/).check();
    await shot("close-confirm");
    await confirmButton.click();

    await expect(page.getByTestId("command-outcome")).toContainText("Revisión 1 del cierre: se crearon 2 créditos de distancia");
    await expect(page.getByTestId("closure-desk")).toHaveAttribute("data-stage", "CLOSED");
    await expect(page.getByTestId("credits-created")).toHaveText("2");
    await expect(page.getByTestId("credit-count")).toHaveText("2");
    await expect(page.getByTestId("credit-guests")).toHaveText("0");
    await expect(page.getByTestId("credit-by-modality")).toContainText("10K: 1");
    await expect(page.getByTestId("credit-by-modality")).toContainText("5K: 1");
    await expect(page.getByTestId("edition-closure-state")).toContainText("Cerrado");
    const counts = creditCounts(flow.editionId);
    expect(counts).toMatchObject({ active: 2, reversed: 0, guests: 0 });
    await shot("closed");
    await scan();
  });

  test("reopen the closure: a reason is mandatory, the credits are reversed and the history shows it; closing again links the new credits", async ({ page, shot }) => {
    const { flow } = seed;
    await signInAs(page, "admin");
    await openClosure(page, flow.editionId);
    await expect(page.getByTestId("closure-desk")).toHaveAttribute("data-stage", "CLOSED");

    await page.getByTestId("reopen-closure-button").click();
    const dialog = dialogOf(page);
    await expect(dialog.getByTestId("command-count")).toHaveText("Afecta a 2 créditos activos.");
    await expect(dialog.getByTestId("command-consequences")).toContainText("periodos de ranking");
    const sent = await watchPosts(page, async () => {
      await dialog.getByRole("button", { name: "Reabrir el cierre" }).click();
      await expect(dialog.getByText("Escribe el motivo: queda en la auditoría.")).toBeVisible();
    });
    expect(sent).toEqual([]);
    await dialog.getByLabel(/Motivo de la reapertura/).fill("Se detectó una descalificación pendiente");
    await shot("reopen-closure");
    await dialog.getByRole("button", { name: "Reabrir el cierre" }).click();

    await expect(page.getByTestId("command-outcome")).toContainText("Se revirtieron 2 créditos de distancia");
    await expect(page.getByTestId("closure-desk")).toHaveAttribute("data-stage", "FINALIZED");
    await expect(page.getByTestId("history-reversal")).toContainText("se revirtieron 2 créditos");
    await expect(page.getByTestId("credit-count")).toHaveText("0");
    expect(creditCounts(flow.editionId)).toMatchObject({ active: 0, reversed: 2 });
    await shot("history-after-reopen");

    // close again: a new revision, and each new credit points at the reversed one
    await page.getByTestId("close-button").click();
    const again = dialogOf(page);
    await again.getByLabel(/Entiendo que se crearán los créditos/).check();
    await again.getByRole("button", { name: "Cerrar la edición" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("Revisión 2 del cierre: se crearon 2 créditos");
    await expect(page.getByTestId("history-closure")).toContainText("Revisión 2: reemplaza una revisión anterior, sustituida");
    expect(creditCounts(flow.editionId)).toMatchObject({ active: 2, reversed: 2, linked: 2, guests: 0 });
  });

  test("a closed Edition: the attendance desk explains the way back and offers no reopen-finalization", async ({ page, shot }) => {
    const { flow } = seed;
    await signInAs(page, "operator");
    await openDesk(page, flow.editionId);
    await expect(page.getByTestId("attendance-desk")).toHaveAttribute("data-stage", "CLOSED");
    await expect(page.getByTestId("closed-note")).toContainText("un administrador global reabre primero el cierre");
    await expect(page.getByTestId("reopen-button")).toHaveCount(0);
    // an operator cannot act on the closure and is not even offered the link
    await expect(page.getByRole("link", { name: "Ir al cierre de la edición" })).toHaveCount(0);
    // eligibility is blocked once closed; the server would answer CLOSURE_BLOCKED
    const disclosure = page.getByRole("button", { name: `Ver detalle de ${flow.people.checkin.name}` });
    if (await disclosure.isVisible()) await disclosure.click();
    await expect(page.getByRole("button", { name: new RegExp(`^Elegibilidad de ${flow.people.checkin.name}$`) })).toHaveCount(0);
    await shot("closed-desk-operator");
  });
});

// ---- Refusals, stale state and recovery ------------------------------------------------------------------------------------------

test.describe("refusals and stale state (each on its own Edition)", () => {
  test.describe.configure({ mode: "serial" });

  test("finalize while someone else already finalized: the server refuses, the desk explains with the reference and refreshes", async ({ page, shot }) => {
    const { race } = seed;
    await signInAs(page, "operator");
    await openDesk(page, race.editionId);
    await expect(page.getByTestId("finalize-button")).toBeEnabled();
    await page.getByTestId("finalize-button").click();
    const dialog = dialogOf(page);

    // someone else finalizes first (same staff session, another key: a second tab or a colleague)
    const other = await page.request.post(api(race.editionId, "attendance/finalize"), { data: {}, headers: { "idempotency-key": randomUUID() } });
    expect(other.status()).toBe(200);

    await dialog.getByRole("button", { name: "Finalizar asistencia" }).click();
    const failure = dialog.getByTestId("command-failure");
    await expect(failure).toContainText("La asistencia ya estaba finalizada");
    await expect(failure).toContainText(/Referencia: \S+/);
    await expect(failure).toContainText("Ya actualizamos la pantalla");
    await shot("finalize-stale");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByTestId("attendance-desk")).toHaveAttribute("data-stage", "FINALIZED");
    expect(currentFinalizationRevision(race.editionId)).toBe(1);
  });

  test("close while someone else already closed: no duplicate, a clear 409 explanation and the refreshed result", async ({ page, shot }) => {
    const { race } = seed;
    await signInAs(page, "admin");
    await openClosure(page, race.editionId);
    await page.getByTestId("close-button").click();
    const dialog = dialogOf(page);
    await dialog.getByLabel(/Entiendo que se crearán los créditos/).check();

    const other = await page.request.post(api(race.editionId, "close"), { data: {}, headers: { "idempotency-key": randomUUID() } });
    expect(other.status()).toBe(200);

    await dialog.getByRole("button", { name: "Cerrar la edición" }).click();
    const failure = dialog.getByTestId("command-failure");
    await expect(failure).toContainText("La edición ya se cerró");
    await expect(failure).toContainText(/Referencia: \S+/);
    await shot("close-conflict");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByTestId("closure-desk")).toHaveAttribute("data-stage", "CLOSED");
    expect(psql(`select count(*) from app.administrative_closure where edition_id = '${race.editionId}' and superseded_at is null`)).toBe("1");
  });

  test("a lost connection retries the SAME Idempotency-Key and applies once; a 429 asks to wait (injected answers)", async ({ page, shot }) => {
    const { perms } = seed;
    await signInAs(page, "operator");
    await openDesk(page, perms.editionId);
    await expect(page.getByTestId("finalize-button")).toBeEnabled();
    await page.getByTestId("finalize-button").click();
    const dialog = dialogOf(page);

    const keys: string[] = [];
    let attempt = 0;
    await page.route(`**${api(perms.editionId, "attendance/finalize")}`, async (route) => {
      attempt += 1;
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      if (attempt === 1) return route.abort("connectionreset");
      if (attempt === 2) {
        return route.fulfill({
          status: 429,
          contentType: "application/json",
          headers: { "retry-after": "7" },
          body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "x", request_id: "req_injected_429", details: { retry_after_seconds: 7 } } }),
        });
      }
      return route.continue();
    });

    await dialog.getByRole("button", { name: "Finalizar asistencia" }).click();
    await expect(dialog.getByTestId("command-failure")).toContainText("Sin conexión con el servidor");
    await dialog.getByRole("button", { name: "Reintentar" }).click();
    await expect(dialog.getByTestId("command-failure")).toContainText("Demasiadas acciones");
    await expect(dialog.getByTestId("command-failure")).toContainText("Vuelve a intentar en 7 s");
    await expect(dialog.getByTestId("command-failure")).toContainText("req_injected_429");
    await shot("finalize-rate-limited");
    await dialog.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByTestId("command-outcome")).toContainText("Asistencia finalizada");
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1); // one intent, one key, whatever the retries
    expect(currentFinalizationRevision(perms.editionId)).toBe(1);
  });

  test("a 403 on close explains that only a global administrator can do it (injected answer)", async ({ page, shot }) => {
    const { perms } = seed;
    await signInAs(page, "admin");
    await openClosure(page, perms.editionId);
    await page.route(`**${api(perms.editionId, "close")}`, (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "x", request_id: "req_injected_403", details: {} } }) }),
    );
    await page.getByTestId("close-button").click();
    const dialog = dialogOf(page);
    await dialog.getByLabel(/Entiendo que se crearán los créditos/).check();
    await dialog.getByRole("button", { name: "Cerrar la edición" }).click();
    const failure = dialog.getByTestId("command-failure");
    await expect(failure).toContainText("Solo un administrador global puede hacerlo");
    await expect(failure).toContainText("administrador con acceso global");
    await expect(failure).toContainText("req_injected_403");
    await shot("close-forbidden");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    expect(psql(`select count(*) from app.administrative_closure where edition_id = '${perms.editionId}'`)).toBe("0");
  });

  test("an Edition that has not finished cannot be finalized, and the blocker says why", async ({ page, shot, scan }) => {
    const { early } = seed;
    await signInAs(page, "operator");
    await openDesk(page, early.editionId);
    await expect(page.getByTestId("finalize-button")).toBeDisabled();
    await expect(page.getByTestId("finalize-blocking")).toContainText("la edición todavía no está marcada como Realizada");
    await expect(page.getByTestId("finalize-readiness").locator('[data-check="EXECUTION_FINISHED"]')).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("bulk-button")).toHaveCount(0); // the bulk step is not offered while the Edition is not finished
    // the same refusal straight from the API
    const response = await page.request.post(api(early.editionId, "attendance/finalize"), { data: {}, headers: { "idempotency-key": randomUUID() } });
    expect(response.status()).toBe(422);
    expect((await response.json()).error.details.reason).toBe("edition_not_finished");
    await shot("not-finished");
    await scan();
  });

  test("the workspace read fails: an actionable error with the reference and a retry that reads it again (injected answer)", async ({ page, shot }) => {
    const { early } = seed;
    await signInAs(page, "operator");
    let fail = true;
    await page.route(`**${api(early.editionId, "attendance")}`, (route) => {
      if (fail && route.request().method() === "GET") {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "x", request_id: "req_injected_503", details: {} } }) });
      }
      return route.continue();
    });
    await page.goto(desk(early.editionId));
    const error = page.getByTestId("workspace-error");
    await expect(error).toContainText("No pudimos cargar la asistencia.");
    await expect(error).toContainText("req_injected_503");
    await shot("workspace-error");
    fail = false;
    await error.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByTestId("attendance-desk")).toBeVisible();
  });

  test("the server cap is visible: a truncated workspace says how many are shown and where to find the rest (injected cap)", async ({ page, shot }) => {
    const { early } = seed;
    await signInAs(page, "operator");
    await page.route(`**${api(early.editionId, "attendance")}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.data.participants_truncated = true;
      body.data.universe_count = 2450;
      return route.fulfill({ response, json: body });
    });
    await openDesk(page, early.editionId);
    const note = page.getByTestId("truncation-note");
    await expect(note).toContainText("Lista parcial");
    await expect(note).toContainText("de 2450");
    await expect(note.getByRole("link", { name: "Ir a Participantes" })).toHaveAttribute("href", `/admin/eventos/${early.editionId}/participantes`);
    await shot("truncated");
  });
});

// ---- Large list ----------------------------------------------------------------------------------------------------------------

test.describe("a large Edition", () => {
  test("130 registrations are paged and searchable, with the counts of the whole Edition", async ({ page, shot, scan }) => {
    const { large } = seed;
    await signInAs(page, "operator");
    await openDesk(page, large.editionId);
    await expectStat(page, "ALL", 130);
    await expectStat(page, "PRESENT", 20);
    await expectStat(page, "PENDING", 110);
    await expect(page.getByTestId("result-summary")).toContainText("Mostrando 1–50 de 130");
    await expect(page.getByTestId("page-position")).toHaveText("Página 1 de 3");
    expect(await page.locator("tbody tr").count()).toBeLessThanOrEqual(100); // 50 rows (+ expanded details), never the whole list

    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(page.getByTestId("result-summary")).toContainText("Mostrando 51–100 de 130");
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(page.getByTestId("result-summary")).toContainText("Mostrando 101–130 de 130");
    await expect(page.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    await shot("large-last-page");

    await page.getByLabel("Filas por página").selectOption("100");
    await expect(page.getByTestId("page-position")).toHaveText("Página 1 de 2");
    await page.getByLabel("Buscar").fill("Grande 042");
    await expect(page.getByTestId("result-summary")).toContainText("Mostrando 1–1 de 1");
    await expect(page.getByTestId("page-position")).toHaveCount(0);
    await page.getByLabel("Buscar").fill("");
    await page.getByTestId("stat-PRESENT").click();
    await expect(page.getByTestId("result-summary")).toContainText("de 20");
    await scan();
  });
});

// ---- Roles ---------------------------------------------------------------------------------------------------------------------

test.describe("roles: the server decides, the UI only hides", () => {
  test("an operator uses the attendance desk but not the closure: no link, a refusal page, and the API says 403", async ({ page, shot }) => {
    const { perms } = seed;
    await signInAs(page, "operator");
    await openDesk(page, perms.editionId);
    await expect(page.getByRole("link", { name: "Cierre", exact: true })).toHaveCount(0);
    await page.goto(closurePage(perms.editionId));
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    await expect(page.getByTestId("closure-desk")).toHaveCount(0);
    await shot("closure-forbidden-operator");
    const response = await page.request.post(api(perms.editionId, "close"), { data: {}, headers: { "idempotency-key": randomUUID() } });
    expect(response.status()).toBe(403);
    // the Edition quick links agree: the closure is listed for an admin only
    await page.goto(`/admin/eventos/${perms.editionId}`);
    await expect(page.getByRole("link", { name: /^Asistencia/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^Cierre/ })).toHaveCount(0);
  });

  test("an admin sees the closure link; a CHECKIN member and an anonymous visitor cannot open the desk", async ({ page }) => {
    const { perms } = seed;
    await signInAs(page, "admin");
    await openDesk(page, perms.editionId);
    await expect(page.getByRole("link", { name: "Cierre", exact: true })).toBeVisible();
    await page.goto(`/admin/eventos/${perms.editionId}`);
    await expect(page.getByRole("link", { name: /^Cierre/ }).first()).toBeVisible();
  });

  test("a CHECKIN member is refused, an anonymous visitor is redirected", async ({ page, browser }) => {
    const { perms } = seed;
    await signInAs(page, "checkin");
    await page.goto(desk(perms.editionId));
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    expect((await page.request.get(api(perms.editionId, "attendance"))).status()).toBe(403);
    const anonymous = await browser.newContext();
    try {
      const response = await anonymous.request.get(desk(perms.editionId), { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain("/entrar");
    } finally {
      await anonymous.close();
    }
  });

  test("an Edition-scoped administrator reads the closure but is never offered close or reopen, and the API refuses (global only)", async ({ page, shot, scan }, testInfo) => {
    const { perms } = seed;
    const email = await signInAsNewUser(page, `cierre-${testInfo.project.name.replace("chromium-", "")}`);
    assignScopedAdmin(email, perms.editionId);
    await openClosure(page, perms.editionId);
    await expect(page.getByTestId("global-only-note")).toContainText("Cerrar y reabrir una edición es solo de un administrador global");
    await expect(page.getByTestId("close-button")).toHaveCount(0);
    await expect(page.getByTestId("reopen-closure-button")).toHaveCount(0);
    await expect(page.getByTestId("close-readiness")).toBeVisible();
    await shot("closure-scoped-admin");
    await scan();
    const close = await page.request.post(api(perms.editionId, "close"), { data: {}, headers: { "idempotency-key": randomUUID() } });
    expect(close.status()).toBe(403);
    const reopen = await page.request.post(api(perms.editionId, "reopen"), { data: { reason: "prueba" }, headers: { "idempotency-key": randomUUID() } });
    expect(reopen.status()).toBe(403);
    // the desk of that Edition is theirs (ADMIN of the Edition may resolve attendance); another Edition is not
    await page.goto(desk(seed.race.editionId));
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
  });
});

// ---- Explicit reads and keyboard -----------------------------------------------------------------------------------------------

test.describe("the workspace is a writing call", () => {
  test("it is read once when the desk opens and only by an explicit action, never prefetched by a link to it", async ({ page }) => {
    const { perms } = seed;
    await signInAs(page, "operator");
    const reads: { url: string; prefetch: string | undefined }[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/attendance") && request.url().includes("/api/v1/admin/") && request.method() === "GET") {
        reads.push({ url: request.url(), prefetch: request.headers()["next-router-prefetch"] ?? request.headers()["sec-purpose"] });
      }
    });
    // the Edition overview links to the desk: rendering that link must not read the workspace
    await page.goto(`/admin/eventos/${perms.editionId}`);
    await expect(page.getByRole("link", { name: /^Asistencia/ }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    expect(reads).toEqual([]);

    await openDesk(page, perms.editionId);
    await expect.poll(() => reads.length).toBeGreaterThanOrEqual(1);
    const opening = reads.length;
    expect(reads.every((read) => read.prefetch === undefined)).toBe(true);
    await page.waitForTimeout(1500);
    expect(reads.length).toBe(opening); // no polling

    await page.getByRole("button", { name: "Actualizar" }).click();
    await expect.poll(() => reads.length).toBe(opening + 1); // the manual refresh is one explicit read
  });

  test("keyboard: a row action opens its dialog, Escape closes it and focus returns to the action", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-mobile", "the row actions live in the detail disclosure on a phone");
    const { large } = seed;
    await signInAs(page, "operator");
    await openDesk(page, large.editionId);
    const first = page.getByRole("button", { name: /^Asistencia de QA Grande 021/ });
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(first).toBeFocused();
  });
});
