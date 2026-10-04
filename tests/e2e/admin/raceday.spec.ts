import { mkdirSync } from "node:fs";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { LOCAL_DB_ONLY } from "../support/account";
import { scanForSeriousViolations } from "../support/axe";
import { e2eEnv } from "../support/env";
import { expect, gotoAndSettle, signInAs, test as base } from "./support";
import { seedRaceday, type Seeded } from "./raceday-support";

/**
 * Race day (P3-H): the scanner for a CHECKIN member on a phone, the guardian desk and the Kit Center. Every outcome is produced by the
 * real server against fixtures written by raceday-support.ts (see scanner-outcomes.md for how each one is reproduced). Needs the local
 * stack (Docker DB, Mailpit) like the other admin specs.
 */
const SHOTS = ".salvaops-agent-evidence/P3-H-raceday-kits-guardian-scanner-checkin/screens";
mkdirSync(SHOTS, { recursive: true });

const test = base.extend<{ shot: (name: string) => Promise<void>; a11y: () => Promise<void> }>({
  shot: async ({ page }, provide, testInfo: TestInfo) => {
    await provide(async (name: string) => {
      await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}--${name}.png`, animations: "disabled" });
    });
  },
  a11y: async ({ page }, provide) => {
    await provide(async () => {
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
      const { serious } = await scanForSeriousViolations(page);
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  },
});

// Chromium's fake camera (a test pattern) lets the real getUserMedia path run; launch options cannot be set per describe group.
test.use({ permissions: ["camera"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
test.describe.configure({ mode: "serial", timeout: 150_000 });
test.skip(!e2eEnv().localDb, LOCAL_DB_ONLY);

let seed: Seeded;
test.beforeAll(() => {
  seed = seedRaceday();
});

// ---- helpers -----------------------------------------------------------------------------------------------------------------

type SessionOptions = { edition?: "main" | "future"; station?: string; operation: "Check-in" | "Entrega de kits"; kit?: string };

async function startSession(page: Page, options: SessionOptions) {
  await page.goto("/scanner");
  await expect(page.getByTestId("session-setup")).toBeVisible();
  const editionId = options.edition === "future" ? seed.futureEditionId : seed.editionId;
  await page.getByLabel("Edición").selectOption(editionId);
  await page.getByLabel("Estación").fill(options.station ?? "Entrada QA");
  await page.getByRole("radio", { name: options.operation }).check();
  if (options.kit) await page.getByLabel("Kit que entregas").selectOption({ label: options.kit });
  await page.getByRole("button", { name: "Empezar a escanear" }).click();
  await expect(page.getByTestId("session-context")).toContainText(options.station ?? "Entrada QA");
}

async function sendCode(page: Page, payload: string) {
  await page.getByLabel("Código del pase").fill(payload);
  await page.getByRole("button", { name: "Enviar" }).click();
}

async function expectOutcome(page: Page, outcome: string, label: string) {
  const screen = page.getByTestId(`scan-outcome-${outcome}`);
  await expect(screen).toBeVisible();
  await expect(screen.getByRole("heading", { name: label })).toBeVisible();
  return screen;
}

/**
 * Below the md breakpoint a DataTable keeps its row actions in the row's detail disclosure (P3-B): open it when it is there, then
 * return the action button (its accessible name carries the person, so it is unique on the page).
 */
async function rowAction(page: Page, person: string, action: RegExp | string): Promise<Locator> {
  const disclosure = page.getByRole("button", { name: `Ver detalle de ${person}` });
  if (await disclosure.isVisible()) await disclosure.click();
  const matcher = typeof action === "string" ? new RegExp(`^${action}.*${person}`) : action;
  return page.getByRole("button", { name: matcher });
}

async function dismiss(page: Page) {
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByTestId("scan-area")).toBeVisible();
}

// ---- Scanner: session --------------------------------------------------------------------------------------------------------

test.describe("scanner session (CHECKIN)", () => {
  test("scanning is blocked until edition, station and operation are chosen", async ({ page, shot, a11y }) => {
    await signInAs(page, "checkin");
    await page.goto("/scanner");
    const setup = page.getByTestId("session-setup");
    await expect(setup).toBeVisible();
    await expect(page.getByLabel("Código del pase")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Activar cámara" })).toHaveCount(0);

    await page.getByRole("button", { name: "Empezar a escanear" }).click();
    await expect(page.getByText("Elige la edición.")).toBeVisible();
    await expect(page.getByText("Escribe el nombre de la estación", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Elige qué vas a hacer en esta estación.")).toBeVisible();
    await expect(page.getByLabel("Código del pase")).toHaveCount(0);
    await shot("scanner-session-incomplete");
    await a11y();

    // the Edition is offered by name even though CHECKIN cannot read the staff Edition list
    await expect(page.getByLabel("Edición").locator(`option[value="${seed.editionId}"]`)).toHaveCount(1);
  });

  test("a complete session opens the scan view with the fixed context, the camera control, the code field and the manual lookup", async ({ page, shot, a11y }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await expect(page.getByTestId("session-context")).toContainText(seed.editionName);
    await expect(page.getByTestId("session-context")).toContainText("Check-in");
    await expect(page.getByRole("button", { name: "Activar cámara" })).toBeVisible();
    await expect(page.getByLabel("Código del pase")).toBeVisible();
    await expect(page.getByRole("button", { name: "Búsqueda manual" })).toBeVisible();
    await shot("scanner-ready");
    await a11y();
    // one-handed use on a phone: no sideways scroll and thumb-sized targets
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of ["Activar cámara", "Enviar", "Búsqueda manual", "Cambiar"]) {
      const box = await page.getByRole("button", { name }).first().boundingBox();
      expect(box?.height, name).toBeGreaterThanOrEqual(44);
    }
    // no attendance language on the scanner: check-in is evidence of arrival, not final attendance
    const text = (await page.getByRole("main").innerText()).toLowerCase();
    expect(text).not.toMatch(/asistencia|presente/);
  });
});

// ---- Scanner: every outcome ----------------------------------------------------------------------------------------------------

test.describe("scanner outcomes (server judged)", () => {
  test("VALID, then the same code again is ALREADY_CHECKED_IN and creates no second record", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await sendCode(page, seed.tokens.valid);
    const valid = await expectOutcome(page, "VALID", "Acceso válido");
    await expect(valid.getByTestId("scan-participant")).toContainText(seed.names.valid);
    await shot("outcome-VALID");
    await dismiss(page);

    await sendCode(page, seed.tokens.valid);
    await expectOutcome(page, "ALREADY_CHECKED_IN", "Ya registrado");
    await shot("outcome-ALREADY_CHECKED_IN");
  });

  test("REVOKED_CREDENTIAL", async ({ page, shot, a11y }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await sendCode(page, seed.tokens.revoked);
    await expectOutcome(page, "REVOKED_CREDENTIAL", "Código revocado");
    await shot("outcome-REVOKED_CREDENTIAL");
    await a11y();
  });

  test("REPLACED_CREDENTIAL: the old code is refused, the new one works", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await sendCode(page, seed.tokens.replacedOld);
    await expectOutcome(page, "REPLACED_CREDENTIAL", "Este código ya no es válido, se reemplazó");
    await shot("outcome-REPLACED_CREDENTIAL");
    await dismiss(page);
    await sendCode(page, seed.tokens.replaced);
    await expectOutcome(page, "VALID", "Acceso válido");
  });

  test("WRONG_EVENT", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await sendCode(page, seed.tokens.other);
    await expectOutcome(page, "WRONG_EVENT", "Este pase no es de este evento");
    await shot("outcome-WRONG_EVENT");
  });

  test("UNKNOWN_PASS (a well-formed code no pass owns)", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    // keyboard only (external readers type the code and press Enter): the field submits on Enter, and the outcome screen takes the focus
    await page.getByLabel("Código del pase").fill(seed.unknownToken);
    await page.getByLabel("Código del pase").press("Enter");
    await expectOutcome(page, "UNKNOWN_PASS", "Código no reconocido");
    await shot("outcome-UNKNOWN_PASS");
    await expect(page.getByRole("button", { name: "Continuar" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("scan-area")).toBeVisible();
  });

  test("a code that is not a pass at all is a clear refusal, never an outcome", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await sendCode(page, "https://example.test/not-a-pass");
    const failure = page.getByTestId("scan-request-error");
    await expect(failure).toBeVisible();
    await expect(failure).toContainText("Ese código no es de un pase");
    await expect(failure).toContainText("Referencia de soporte");
    await expect(page.locator('[data-testid^="scan-outcome-"]')).toHaveCount(0);
    await shot("scan-malformed-code");
  });

  test("CANCELED_REGISTRATION", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await sendCode(page, seed.tokens.canceled);
    await expectOutcome(page, "CANCELED_REGISTRATION", "Inscripción cancelada");
    await shot("outcome-CANCELED_REGISTRATION");
  });

  test("NOT_YET_ALLOWED (an Edition whose check-in window has not opened)", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in", edition: "future" });
    await sendCode(page, seed.tokens.future);
    await expectOutcome(page, "NOT_YET_ALLOWED", "Aún no es hora de ingreso");
    await shot("outcome-NOT_YET_ALLOWED");
  });

  test("GUARDIAN_VERIFICATION_REQUIRED: Verificar re-runs the check-in and the same screen becomes VALID", async ({ page, shot, a11y }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await sendCode(page, seed.tokens.minor);
    await expectOutcome(page, "GUARDIAN_VERIFICATION_REQUIRED", "Requiere verificar guardián");
    const panel = page.getByTestId("guardian-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("scan-participant")).toContainText("Menor de edad");
    await shot("outcome-GUARDIAN_VERIFICATION_REQUIRED");
    await a11y();

    // a decision is shown only after the server answers
    await panel.getByRole("button", { name: "Verificar" }).click();
    await expectOutcome(page, "VALID", "Acceso válido");
    await shot("guardian-verified-then-valid");
  });

  test("GUARDIAN rejected: blocked state, and scanning again is OTHER_REVIEW", async ({ page, shot, a11y }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await sendCode(page, seed.tokens.minorReject);
    await expectOutcome(page, "GUARDIAN_VERIFICATION_REQUIRED", "Requiere verificar guardián");
    const panel = page.getByTestId("guardian-panel");
    // Rechazar needs a reason: nothing is sent without it
    await panel.getByRole("button", { name: "Rechazar" }).click();
    await expect(panel.getByText("Indica por qué se rechaza")).toBeVisible();
    await panel.getByLabel("Notas (nombre del adulto, observaciones)").fill("No pudo acreditar parentesco");
    await panel.getByRole("button", { name: "Rechazar" }).click();
    const blocked = page.getByTestId("scan-guardian-blocked");
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText("Verificación rechazada");
    await shot("guardian-rejected-blocked");
    await a11y();
    await dismiss(page);

    await sendCode(page, seed.tokens.minorReject);
    await expectOutcome(page, "OTHER_REVIEW", "Revisar manualmente");
    await shot("outcome-OTHER_REVIEW");
  });

  test("REGISTRATION_NOT_CONFIRMED renders as the server says it (no real data can reach it, so the answer is injected)", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await page.route("**/api/v1/check-in", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { participant_pass_scan_id: "00000000-0000-4000-8000-000000000001", outcome: "REGISTRATION_NOT_CONFIRMED", scanned_at: new Date().toISOString(), participant: null },
        }),
      }),
    );
    await sendCode(page, seed.unknownToken);
    await expectOutcome(page, "REGISTRATION_NOT_CONFIRMED", "Inscripción no confirmada aún");
    await shot("outcome-REGISTRATION_NOT_CONFIRMED");
  });

  test("an outcome this build does not know is never shown as a state", async ({ page }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await page.route("**/api/v1/check-in", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { outcome: "PERFECTLY_FINE", participant: null } }) }),
    );
    await sendCode(page, seed.unknownToken);
    await expect(page.getByTestId("scan-request-error")).toBeVisible();
    await expect(page.locator('[data-testid^="scan-outcome-"]')).toHaveCount(0);
  });
});

// ---- Scanner: network ------------------------------------------------------------------------------------------------------------

test.describe("scanner network loss", () => {
  test("a lost connection is explicit, never accepts the code, and Reintentar re-sends it", async ({ page, shot, a11y }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await page.route("**/api/v1/check-in", (route) => route.abort("failed"));
    await sendCode(page, seed.tokens.manual);
    const lost = page.getByTestId("scan-network-error");
    await expect(lost).toBeVisible();
    await expect(lost.getByRole("heading", { name: "Sin conexión, reintenta" })).toBeVisible();
    await expect(page.locator('[data-testid^="scan-outcome-"]')).toHaveCount(0);
    await shot("scan-network-error");
    await a11y();

    await page.unroute("**/api/v1/check-in");
    await lost.getByRole("button", { name: "Reintentar" }).click();
    await expectOutcome(page, "VALID", "Acceso válido");
  });

  test("a kit pickup retried after a lost connection reuses the same Idempotency-Key and delivers once", async ({ page }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Entrega de kits", kit: seed.kitMainName });
    const keys: string[] = [];
    await page.route("**/api/v1/admin/kits/pickup", (route) => {
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      return keys.length === 1 ? route.abort("failed") : route.continue();
    });
    await sendCode(page, seed.tokens.kitThird);
    await expect(page.getByTestId("scan-network-error")).toBeVisible();
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expectOutcome(page, "VALID", "Acceso válido");
    await expect(page.getByTestId("scan-outcome-VALID")).toContainText("Kit entregado.");
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe("");
    expect(keys[1]).toBe(keys[0]);
  });

  test("going offline shows a banner and blocks sending until the connection returns", async ({ page, context }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await context.setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar" })).toBeDisabled();
    await context.setOffline(false);
    await expect(page.getByTestId("offline-banner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enviar" })).toBeEnabled();
  });
});

// ---- Scanner: kits ------------------------------------------------------------------------------------------------------------------

test.describe("scanner kit pickup", () => {
  test("VALID delivery, then a second scan is ALREADY_CHECKED_IN (Ya entregado)", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Entrega de kits", kit: seed.kitMainName });
    await sendCode(page, seed.tokens.kitScan);
    await expectOutcome(page, "VALID", "Acceso válido");
    await expect(page.getByTestId("scan-outcome-VALID")).toContainText("Kit entregado.");
    await shot("kit-VALID");
    await dismiss(page);
    await sendCode(page, seed.tokens.kitScan);
    await expectOutcome(page, "ALREADY_CHECKED_IN", "Ya registrado");
    await expect(page.getByTestId("scan-outcome-ALREADY_CHECKED_IN")).toContainText("Ya entregado");
    await shot("kit-ALREADY_CHECKED_IN");
  });

  test("a participant with no kit allocated is OTHER_REVIEW; a kit whose window has not opened is NOT_YET_ALLOWED", async ({ page, shot }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Entrega de kits", kit: seed.kitMainName });
    await sendCode(page, seed.tokens.kitNone);
    await expectOutcome(page, "OTHER_REVIEW", "Revisar manualmente");
    await shot("kit-OTHER_REVIEW");

    await page.getByRole("button", { name: "Cambiar" }).click();
    await page.getByLabel("Edición").selectOption(seed.editionId);
    await page.getByLabel("Estación").fill("Mesa kits QA");
    await page.getByRole("radio", { name: "Entrega de kits" }).check();
    await page.getByLabel("Kit que entregas").selectOption({ label: seed.kitFutureName });
    await page.getByRole("button", { name: "Empezar a escanear" }).click();
    await sendCode(page, seed.tokens.kitEarly);
    await expectOutcome(page, "NOT_YET_ALLOWED", "Aún no es hora de ingreso");
    await shot("kit-NOT_YET_ALLOWED");
  });
});

// ---- Scanner: camera -----------------------------------------------------------------------------------------------------------------

test.describe("scanner camera", () => {
  test("the camera path reads a code through the browser API and hands it to the server unchanged", async ({ page, shot }) => {
    // Chromium's fake camera shows a test pattern, not a QR. The detector is replaced so the decoded text is whatever the test says;
    // everything else (permission, stream, the detection loop, the request) is the real path.
    await page.addInitScript(() => {
      (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
        async detect() {
          const value = (window as unknown as { __qr?: string }).__qr;
          return value ? [{ rawValue: value }] : [];
        }
      };
    });
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/check-in")) requests.push(request.postData() ?? "");
    });
    await page.getByRole("button", { name: "Activar cámara" }).click();
    await expect(page.getByRole("button", { name: "Apagar cámara" })).toBeVisible();
    await expect(page.getByTestId("scanner-video")).toBeVisible();
    await shot("scanner-camera-live");

    await page.evaluate((payload) => ((window as unknown as { __qr: string }).__qr = payload), seed.tokens.manualMinor);
    await expectOutcome(page, "GUARDIAN_VERIFICATION_REQUIRED", "Requiere verificar guardián");
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]).credential_token).toBe(seed.tokens.manualMinor);
    // the code never appears in the address bar
    expect(page.url()).not.toContain("RN1");
  });

  test("when the browser cannot read QR codes the page says so and the typed code still works", async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    });
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await page.getByRole("button", { name: "Activar cámara" }).click();
    await expect(page.getByText("no puede leer códigos QR con la cámara")).toBeVisible();
    await expect(page.getByLabel("Código del pase")).toBeVisible();
  });
});

// ---- Scanner: manual lookup --------------------------------------------------------------------------------------------------------

test.describe("scanner manual lookup", () => {
  test("search by name needs 3 characters, check-in needs a reason, and the same server checks apply", async ({ page, shot, a11y }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await page.getByRole("button", { name: "Búsqueda manual" }).click();
    const lookup = page.getByTestId("manual-lookup");
    await expect(lookup).toBeVisible();
    // the session context stays visible above the drawer
    await expect(page.getByTestId("session-context")).toBeVisible();

    await lookup.getByLabel("Nombre o número de inscripción").fill("ab");
    await lookup.getByRole("button", { name: "Buscar" }).click();
    await expect(lookup.getByText("Escribe al menos 3 letras o números.")).toBeVisible();

    await lookup.getByLabel("Nombre o número de inscripción").fill(`Manual Llegada ${seed.suffix}`);
    await lookup.getByRole("button", { name: "Buscar" }).click();
    await lookup.getByRole("button", { name: new RegExp(seed.names.manual) }).click();
    const action = page.getByTestId("lookup-action");
    await expect(action.getByRole("button", { name: "Registrar llegada" })).toBeDisabled();
    await shot("scanner-manual-lookup");
    await a11y();

    await action.getByLabel("Motivo del registro manual").fill("Teléfono sin batería");
    await action.getByRole("button", { name: "Registrar llegada" }).click();
    // a manual check-in answers with the same outcome vocabulary; the person was already checked in by the retry test above
    const outcome = page.locator('[data-testid^="scan-outcome-"]');
    await expect(outcome).toBeVisible();
    expect(["scan-outcome-VALID", "scan-outcome-ALREADY_CHECKED_IN"]).toContain(await outcome.getAttribute("data-testid"));
  });

  test("a minor found by name goes through the same guardian dialog, then checks in", async ({ page }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Check-in" });
    await page.getByRole("button", { name: "Búsqueda manual" }).click();
    const lookup = page.getByTestId("manual-lookup");
    await lookup.getByLabel("Nombre o número de inscripción").fill(seed.numbers.manualMinor);
    await lookup.getByRole("button", { name: "Buscar" }).click();
    await expect(lookup.getByText("Menor: guardián por verificar")).toBeVisible();
    await lookup.getByRole("button", { name: new RegExp(seed.names.manualMinor) }).click();
    await lookup.getByLabel("Motivo del registro manual").fill("Sin QR");
    await lookup.getByRole("button", { name: "Registrar llegada" }).click();
    await expectOutcome(page, "GUARDIAN_VERIFICATION_REQUIRED", "Requiere verificar guardián");
    await page.getByTestId("guardian-panel").getByRole("button", { name: "Verificar" }).click();
    await expectOutcome(page, "VALID", "Acceso válido");
  });

  test("kit desk: a third party needs a reason before the delivery is sent", async ({ page }) => {
    await signInAs(page, "checkin");
    await startSession(page, { operation: "Entrega de kits", kit: seed.kitMainName });
    await page.getByRole("button", { name: "Búsqueda manual" }).click();
    const lookup = page.getByTestId("manual-lookup");
    await lookup.getByLabel("Nombre o número de inscripción").fill(`Kit Manual ${seed.suffix}`);
    await lookup.getByRole("button", { name: "Buscar" }).click();
    await lookup.getByRole("button", { name: new RegExp(seed.names.kitManual) }).click();
    const action = page.getByTestId("lookup-action");
    await action.getByLabel("Lo recoge otra persona").check();
    await expect(action.getByRole("button", { name: "Entregar kit" })).toBeDisabled();
    await action.getByLabel("Quién recoge y por qué").fill("Su hermano, con carta firmada");
    await action.getByRole("button", { name: "Entregar kit" }).click();
    await expectOutcome(page, "VALID", "Acceso válido");
    await expect(page.getByTestId("scan-outcome-VALID")).toContainText("Kit entregado.");
  });
});

// ---- Guardian desk -------------------------------------------------------------------------------------------------------------------

test.describe("guardian desk", () => {
  test("lists the pending minors of the Edition and records the decision through the API", async ({ page, shot, a11y }) => {
    await signInAs(page, "checkin");
    // The pending row is created by the first scan of a minor's pass (done through the same API the scanner uses).
    for (const key of ["minorDesk", "minorDeskReject"] as const) {
      const response = await page.request.post("/api/v1/check-in", { data: { edition_id: seed.editionId, credential_token: seed.tokens[key], station_key: "Mesa QA" } });
      expect(response.status()).toBe(200);
      expect((await response.json()).data.outcome).toBe("GUARDIAN_VERIFICATION_REQUIRED");
    }
    await gotoAndSettle(page, `/admin/eventos/${seed.editionId}/tutores`);
    await expect(page.getByRole("heading", { level: 1, name: "Mesa de tutores" })).toBeAttached();
    const row = page.getByRole("row", { name: new RegExp(seed.names.minorDesk) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Por verificar");
    await shot("guardian-desk");
    await a11y();

    await (await rowAction(page, seed.names.minorDesk, "Verificar")).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Notas (nombre del adulto, observaciones)").fill("Madre, INE vigente");
    await dialog.getByRole("button", { name: "Verificar guardián" }).click();
    await expect(page.getByText("Guardián verificado", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("row", { name: new RegExp(seed.names.minorDesk) })).toHaveCount(0);

    // and the scanner now lets the minor in
    const scan = await page.request.post("/api/v1/check-in", { data: { edition_id: seed.editionId, credential_token: seed.tokens.minorDesk, station_key: "Mesa QA" } });
    expect((await scan.json()).data.outcome).toBe("VALID");

    // rejecting needs a reason; the rejected minor stays listed as rejected, with no further action
    await (await rowAction(page, seed.names.minorDeskReject, "Rechazar")).click();
    const reject = page.getByRole("dialog");
    await reject.getByRole("button", { name: "Rechazar verificación" }).click();
    await expect(reject.getByText("Indica por qué se rechaza")).toBeVisible();
    await reject.getByLabel("Motivo").fill("No acreditó parentesco");
    await reject.getByRole("button", { name: "Rechazar verificación" }).click();
    await expect(page.getByText("Verificación rechazada", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const rejected = page.getByRole("row", { name: new RegExp(seed.names.minorDeskReject) }).first();
    await expect(rejected).toContainText("Rechazada");
    await expect(page.getByRole("button", { name: new RegExp(`Verificar.*${seed.names.minorDeskReject}`) })).toHaveCount(0);
    const again = await page.request.post("/api/v1/check-in", { data: { edition_id: seed.editionId, credential_token: seed.tokens.minorDeskReject, station_key: "Mesa QA" } });
    expect((await again.json()).data.outcome).toBe("OTHER_REVIEW");
  });

  test("a MODERATOR is refused the desk and the scanner", async ({ page }) => {
    await signInAs(page, "moderator");
    await gotoAndSettle(page, `/admin/eventos/${seed.editionId}/tutores`);
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    await gotoAndSettle(page, "/scanner");
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    await expect(page.getByTestId("session-setup")).toHaveCount(0);
  });
});

// ---- Kit Center ----------------------------------------------------------------------------------------------------------------------

test.describe("kit centre (OPERATOR)", () => {
  test("a CHECKIN member cannot open the kit centre", async ({ page }) => {
    await signInAs(page, "checkin");
    await gotoAndSettle(page, `/admin/eventos/${seed.editionId}/kits`);
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
  });

  test("inventory by variant, hand a kit over without a QR, and reverse it", async ({ page, shot, a11y }) => {
    await signInAs(page, "operator");
    await gotoAndSettle(page, `/admin/eventos/${seed.editionId}/kits`);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`Kits · ${seed.editionName}`) })).toBeAttached();
    const kit = page.locator(`[data-kit-name="${seed.kitMainName}"]`);
    await expect(kit).toBeVisible();
    await expect(kit.locator('[data-variant-key="M"]')).toContainText("Talla M");
    await expect(kit.locator('[data-variant-key="M"]')).toContainText("40");
    await shot("kits-inventory");
    await a11y();

    await page.getByRole("searchbox").first().fill(seed.numbers.kitUi);
    await page.getByRole("searchbox").first().press("Enter");
    // the filtered list replaces the first page: act only once it is the only row
    await expect(page.getByText("1 participante en esta página")).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(seed.names.kitUi) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Asignado");
    await (await rowAction(page, seed.names.kitUi, "Entregar kit")).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Kit").selectOption({ label: seed.kitMainName });
    await shot("kits-pickup-dialog");
    await a11y();
    await dialog.getByRole("button", { name: "Entregar kit" }).click();
    await expect(page.getByRole("row", { name: new RegExp(seed.names.kitUi) }).first()).toContainText("Entregado");
    const deliveries = page.getByTestId("session-deliveries");
    await expect(deliveries).toContainText(seed.names.kitUi);

    await deliveries.getByRole("button", { name: /Revertir entrega/ }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByRole("button", { name: "Revertir entrega" })).toBeDisabled();
    await confirm.getByLabel(/Motivo/).fill("Entregado a la persona equivocada");
    await confirm.getByRole("button", { name: "Revertir entrega" }).click();
    await expect(page.getByRole("row", { name: new RegExp(seed.names.kitUi) }).first()).toContainText("Asignado");
  });

  test("a delivery for another person needs the reason before it is sent", async ({ page }) => {
    await signInAs(page, "operator");
    await gotoAndSettle(page, `/admin/eventos/${seed.editionId}/kits?search=${encodeURIComponent(seed.numbers.kitUiThird)}`);
    await (await rowAction(page, seed.names.kitUiThird, "Entregar kit")).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Kit").selectOption({ label: seed.kitMainName });
    await dialog.getByLabel("Lo recoge otra persona").check();
    await dialog.getByRole("button", { name: "Entregar kit" }).click();
    await expect(dialog.getByText("es obligatorio")).toBeVisible();
    await dialog.getByLabel("Quién lo recoge y por qué").fill("Su pareja con identificación");
    await dialog.getByRole("button", { name: "Entregar kit" }).click();
    await expect(page.getByRole("row", { name: new RegExp(seed.names.kitUiThird) }).first()).toContainText("Entregado");
  });

  test("create a kit with sizes, add a size, lower a capacity below the allocations only with acknowledgement", async ({ page, shot }) => {
    await signInAs(page, "operator");
    await gotoAndSettle(page, `/admin/eventos/${seed.editionId}/kits`);
    await page.getByRole("button", { name: "Nuevo kit" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Crear kit" }).click();
    await expect(dialog.getByText("Escribe el nombre del kit.")).toBeVisible();
    await dialog.getByLabel("Nombre del kit").fill(`Kit Gorra ${seed.suffix}`);
    await dialog.getByLabel("Cierra la entrega").fill("2020-01-01T10:00");
    await dialog.getByLabel("Abre la entrega").fill("2020-01-02T10:00");
    await dialog.getByRole("button", { name: "Crear kit" }).click();
    await expect(dialog.getByText("El cierre debe ser posterior a la apertura.")).toBeVisible();
    await dialog.getByLabel("Abre la entrega").fill("2030-01-01T08:00");
    await dialog.getByLabel("Cierra la entrega").fill("2030-01-01T18:00");
    await dialog.getByLabel("S", { exact: true }).check();
    await dialog.getByLabel("L", { exact: true }).check();
    await dialog.getByRole("button", { name: "Crear kit" }).click();
    const created = page.locator(`[data-kit-name="Kit Gorra ${seed.suffix}"]`);
    await expect(created).toBeVisible();
    await expect(created.locator('[data-variant-key="S"]')).toBeVisible();
    await shot("kits-created");

    // Talla M of the main kit has several allocations: a capacity under that needs the acknowledgement.
    const main = page.locator(`[data-kit-name="${seed.kitMainName}"]`);
    await main.locator('[data-variant-key="M"]').getByRole("button", { name: /Editar/ }).click();
    const edit = page.getByRole("dialog");
    await edit.getByLabel("Capacidad").fill("1");
    await edit.getByRole("button", { name: "Guardar talla" }).click();
    await expect(edit.getByText(/Confirma abajo/)).toBeVisible();
    await edit.getByLabel(/Entiendo que ya hay/).check();
    await edit.getByRole("button", { name: "Guardar talla" }).click();
    await expect(main.locator('[data-variant-key="M"]')).toContainText("1");

    // add a size to the new kit, then rename the kit
    await created.getByRole("button", { name: /Agregar talla/ }).click();
    const add = page.getByRole("dialog");
    await add.getByRole("button", { name: "Agregar talla" }).click();
    await expect(add.getByText(/Usa 1 a 32 letras/)).toBeVisible();
    await add.getByLabel("Clave").fill("XL");
    await add.getByLabel("Nombre visible").fill("Talla XL");
    await add.getByLabel("Capacidad").fill("12");
    await add.getByRole("button", { name: "Agregar talla" }).click();
    await expect(created.locator('[data-variant-key="XL"]')).toContainText("12");
    await created.getByRole("button", { name: /Editar.*el kit/ }).click();
    const rename = page.getByRole("dialog");
    await rename.getByLabel("Nombre del kit").fill(`Kit Gorra Pro ${seed.suffix}`);
    await rename.getByRole("button", { name: "Guardar kit" }).click();
    await expect(page.locator(`[data-kit-name="Kit Gorra Pro ${seed.suffix}"]`)).toBeVisible();
  });

  test("replacing a QR asks for a reason and retires the old code at once", async ({ page, shot }) => {
    await signInAs(page, "operator");
    await gotoAndSettle(page, `/admin/eventos/${seed.editionId}/kits?search=${encodeURIComponent(seed.numbers.kitQr)}`);
    await (await rowAction(page, seed.names.kitQr, "Reemplazar QR")).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reemplazar QR" })).toBeDisabled();
    await dialog.getByLabel(/Motivo/).fill("Se perdió el teléfono");
    await shot("kits-replace-qr");
    await dialog.getByRole("button", { name: "Reemplazar QR" }).click();
    await expect(page.getByText("QR reemplazado", { exact: true }).first()).toBeVisible();

    // the previous code is now refused by the scanner
    const scan = await page.request.post("/api/v1/check-in", { data: { edition_id: seed.editionId, credential_token: seed.tokens.kitQr, station_key: "Mesa QA" } });
    expect((await scan.json()).data.outcome).toBe("REPLACED_CREDENTIAL");
  });
});
