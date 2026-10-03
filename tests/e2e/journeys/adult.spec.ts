import { createReadyUser } from "../support/account";
import { settleNetwork } from "../support/settle";
import {
  continueButton,
  expect,
  fillDetails,
  openRegistration,
  registerThroughUi,
  requestData,
  skipWithoutFixtureAdmin,
  submitAndWait,
  test,
} from "../support/journey";

// Phase 2 participant journeys (Roadmap 8.22), part 1: the adult buyer for themself.
// FREE confirms at once (no hold, no payment language); EXTERNAL_WHATSAPP holds the places for 24 h absolute and
// the countdown comes from the server. Every journey registers fresh fixture users into a per-worker isolated
// edition (qa-e2e-<run>-...), never into the owner-facing qa-p2 editions.
test.describe.configure({ timeout: 240_000 });
test.beforeEach(() => skipWithoutFixtureAdmin());

const DAY_SECONDS = 24 * 60 * 60;

/** "Dd HH:MM" (a day or more) or "HH:MM:SS" (under a day), as CountdownStatus renders it. */
function timerSeconds(text: string): number {
  const days = /^(\d+)d (\d\d):(\d\d)$/.exec(text.trim());
  if (days) return Number(days[1]) * DAY_SECONDS + Number(days[2]) * 3600 + Number(days[3]) * 60;
  const clock = /^(\d\d):(\d\d):(\d\d)$/.exec(text.trim());
  if (!clock) throw new Error(`unexpected countdown text: ${text}`);
  return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
}

test("Adult FREE: confirmed at once, no hold, no wa.me, a pass of their own", async ({ page, world, a11y, evidence, consoleErrors }) => {
  const edition = await world.edition("free");
  const user = await createReadyUser(page, "adultfree");

  const response = await registerThroughUi(page, edition, {
    details: { modality: /^5K/, shirt: "M", club: "Club Humo" },
    accept: [user.name],
  });
  const request = await requestData(response!);

  // The server's view: FREE has no hold, no WhatsApp handoff, no price and a registration with a pass.
  expect(request).toMatchObject({ status: "CONFIRMED", expires_at: null, whatsapp_url: null, total_snapshot_minor: 0 });
  expect(request.participants).toHaveLength(1);
  expect(request.participants[0].registration?.participant_pass_id).toBeTruthy();
  expect(request.participants[0].legal_acceptance_status).toBe("ACCEPTED");

  // The page says so, and offers nothing that belongs to a hold.
  const outcome = page.getByTestId("request-outcome");
  await expect(outcome).toHaveAttribute("data-status", "CONFIRMED");
  await expect(page.getByRole("heading", { name: /Tu inscripción está confirmada/ })).toBeVisible();
  await expect(page.getByTestId("hold-panel")).toHaveCount(0);
  await expect(page.getByRole("timer")).toHaveCount(0);
  await expect(page.locator('a[href^="https://wa.me"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancelar solicitud" })).toHaveCount(0);
  await a11y();
  await evidence("adult-free-confirmada");

  // The next visit is told about it: the person already has a place and is not offered a duplicate.
  await page.goto(`/inscripcion/${edition.slug}`);
  await expect(page.getByTestId("existing-registrations")).toBeVisible();
  await expect(page.getByTestId("existing-registrations")).toContainText(user.name);
  await expect(page.getByRole("checkbox", { name: new RegExp(user.name) })).toBeDisabled();
  await expect(page.getByText("Ya tienes un lugar en este evento.")).toBeVisible();

  // The pass is real and valid in the account.
  await page.goto("/cuenta/pases");
  await settleNetwork(page);
  await expect(page.getByTestId("pass-row").first()).toHaveAttribute("data-pass-state", "VALID");
  expect(consoleErrors.filter((text) => !/status of (401|403|404|409) /.test(text))).toEqual([]);
});

test("Adult WhatsApp: pending 24 h absolute, wa.me without personal data, server countdown, no extension, cancel", async ({ page, context, world, a11y, evidence }) => {
  const edition = await world.edition("wa");
  const user = await createReadyUser(page, "adultwa");

  const response = await registerThroughUi(page, edition, {
    details: { modality: /^10K/, category: /Recreativa/, shirt: "L" },
    accept: [user.name],
  });
  const request = await requestData(response!);

  // Server contract: PENDING_CONFIRMATION, one absolute 24 h window from the server clock, wa.me with edition + reference only.
  expect(request.status).toBe("PENDING_CONFIRMATION");
  expect(request.registration_request_id).toBeTruthy();
  const holdSeconds = (Date.parse(request.expires_at!) - Date.parse(request.server_time)) / 1000;
  expect(holdSeconds).toBeGreaterThan(DAY_SECONDS - 120);
  expect(holdSeconds).toBeLessThanOrEqual(DAY_SECONDS);
  expect(request.participants[0].registration, "a request is not a registration").toBeNull();
  const wa = new URL(request.whatsapp_url!);
  expect(wa.origin + wa.pathname).toMatch(/^https:\/\/wa\.me\/\d{8,15}$/);
  const text = wa.searchParams.get("text") ?? "";
  expect(text).toMatch(/^Hola\. Quiero completar mi inscripción a .+\. Referencia: R-[0-9A-Z]{4}-[0-9A-Z]{4}\.$/);
  expect(text).toContain(request.public_reference);
  expect(text.toLowerCase()).not.toContain(user.name.toLowerCase());
  expect(text).not.toContain(user.email);
  expect(text).not.toMatch(/1991|\+52811/);

  // The screen: apartado, countdown, handoff opens a new tab, honest copy.
  await expect(page.getByRole("heading", { name: "Tus lugares están apartados" })).toBeVisible();
  await expect(page.getByTestId("public-reference")).toHaveText(request.public_reference);
  const handoff = page.getByTestId("whatsapp-handoff");
  await expect(handoff).toHaveAttribute("href", request.whatsapp_url!);
  await expect(handoff).toHaveAttribute("target", "_blank");
  await expect(handoff).toHaveAttribute("rel", /noopener/);
  await expect(page.getByText("Apartar no es pagar")).toBeVisible();
  await expect(page.getByText(/pagad[oa]/i)).toHaveCount(0);
  await expect(page.getByRole("timer")).not.toHaveText("--:--:--");
  const shown = timerSeconds((await page.getByRole("timer").innerText()).trim());
  expect(shown).toBeGreaterThan(DAY_SECONDS - 180);
  expect(shown).toBeLessThanOrEqual(DAY_SECONDS);
  await a11y();
  await evidence("adult-wa-apartado");

  // Countdown comes from the server, not the device: a device clock three days ahead still shows ~24 h left.
  const skewed = await context.newPage();
  await skewed.clock.install({ time: new Date(Date.now() + 3 * DAY_SECONDS * 1000) });
  await skewed.goto(`/inscripcion/${edition.slug}`);
  await expect(skewed.getByRole("heading", { name: "Ya tienes una solicitud pendiente para este evento" })).toBeVisible({ timeout: 30_000 });
  await skewed.waitForFunction(() => !/--/.test(document.querySelector('[role="timer"]')?.textContent ?? "--"));
  const skewedSeconds = timerSeconds((await skewed.getByRole("timer").innerText()).trim());
  expect(Math.abs(skewedSeconds - shown)).toBeLessThan(180);
  await expect(skewed.getByText("El apartado venció")).toHaveCount(0);
  await skewed.close();

  // Reloading neither restarts nor extends the hold: same absolute expiry, no builder while one is pending.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ya tienes una solicitud pendiente para este evento" })).toBeVisible();
  await expect(page.getByTestId("registration-step")).toHaveCount(0);
  const reread = await page.request.get(`/api/v1/registration-requests/${request.registration_request_id}`);
  expect(reread.status()).toBe(200);
  const stored = ((await reread.json()) as { data: { expires_at: string; status: string } }).data;
  expect(stored.expires_at).toBe(request.expires_at);
  expect(stored.status).toBe("PENDING_CONFIRMATION");

  // Cancel releases the hold and offers a new request, never "retry the old one".
  await page.getByRole("button", { name: "Cancelar solicitud" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("No se puede deshacer");
  await dialog.getByLabel("Motivo (opcional)").fill("Prueba de cancelación");
  await dialog.getByRole("button", { name: "Sí, cancelar solicitud" }).click();
  await expect(page.getByText("Cancelada por ti").first()).toBeVisible();
  await expect(page.getByTestId("hold-panel")).toHaveCount(0);
  await expect(page.locator('a[href^="https://wa.me"]')).toHaveCount(0);
  const canceled = await page.request.get(`/api/v1/registration-requests/${request.registration_request_id}`);
  expect(((await canceled.json()) as { data: { status: string } }).data.status).toBe("CANCELED_BY_BUYER");
  await page.getByRole("button", { name: "Hacer una nueva solicitud" }).click();
  await expect(page.getByRole("heading", { name: "¿Quién se inscribe?" })).toBeVisible();
  await evidence("adult-wa-cancelada");
});

test("Invalid form: field errors, nothing lost, the server's FORM_INVALID lands on the right field", async ({ page, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const user = await createReadyUser(page, "invalidform");

  await openRegistration(page, edition.slug);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();

  // Nothing chosen: both the modality and the required answer are flagged; the page stays on the step.
  await continueButton(page).click();
  await expect(page.getByTestId("step-error")).toHaveText("Revisa los datos marcados.");
  const card = page.getByTestId("details-card");
  await a11y();
  await evidence("invalid-form-errores");

  // Typed input survives a failed validation; the required select is flagged and described.
  await card.getByRole("radio", { name: /^5K/ }).click();
  await card.getByLabel(/Club/).fill("Club Humo");
  await continueButton(page).click();
  await expect(card.getByText("Este campo es obligatorio.")).toBeVisible();
  const shirt = card.getByRole("combobox", { name: /Talla de playera/ });
  await expect(shirt).toHaveAttribute("aria-invalid", "true");
  await expect(card.getByLabel(/Club/)).toHaveValue("Club Humo");
  await expect(card.getByRole("radio", { name: /^5K/ })).toHaveAttribute("aria-checked", "true");

  // A server-side rejection (answer swapped to an option that does not exist, in flight) maps back to the field.
  await fillDetails(page, null, { modality: /^5K/, shirt: "M" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();
  for (const box of await page.getByTestId("legal-card").filter({ hasText: user.name }).getByRole("checkbox").all()) await box.click();
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  let tampered = true;
  await page.route("**/api/v1/registration-requests", async (route) => {
    if (route.request().method() !== "POST" || !tampered) return route.continue();
    const body = route.request().postDataJSON() as { participants: { responses: Record<string, unknown> }[] };
    body.participants[0].responses.shirt_size = "ZZ";
    return route.continue({ postData: JSON.stringify(body) });
  });
  const rejected = await submitAndWait(page, "FREE");
  expect(rejected.status()).toBe(422);
  expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe("FORM_INVALID");
  tampered = false;
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await expect(card.getByText("Elige una opción de la lista.")).toBeVisible();
  await expect(card.getByLabel(/Club/)).toHaveValue("Club Humo");
  await expect(card.getByRole("radio", { name: /^5K/ })).toHaveAttribute("aria-checked", "true");
  await evidence("invalid-form-servidor");

  // Fixing the field and sending again works: nothing had to be retyped.
  await fillDetails(page, null, { modality: /^5K/, shirt: "S" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  const accepted = await requestData(await submitAndWait(page, "FREE"));
  expect(accepted.status).toBe("CONFIRMED");
});
