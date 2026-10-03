import type { Page } from "@playwright/test";
import { createReadyUser, psql } from "../support/account";
import { e2eEnv } from "../support/env";
import {
  expect,
  LOCAL_SQL_ONLY,
  newBuyer,
  openRegistration,
  registerThroughUi,
  requestData,
  skipWithoutFixtureAdmin,
  submitAndWait,
  test,
  type Buyer,
  type FixtureEdition,
} from "../support/journey";

// Phase 2 participant journeys (Roadmap 8.22), part 3: capacity and time.
// Last slot race: two buyers, capacity 1, exactly one succeeds. Expired hold: the screen flips without waiting 24 h
// (browser clock) and, locally, the server-derived expiry releases the place for the next buyer.
test.describe.configure({ timeout: 300_000 });
test.beforeEach(() => skipWithoutFixtureAdmin());

const DAY_MS = 24 * 60 * 60 * 1000;

async function toReview(buyer: Buyer, edition: FixtureEdition) {
  await registerThroughUi(buyer.page, edition, {
    details: { modality: /^5K/, shirt: "M" },
    accept: [buyer.user.name],
    stopAtReview: true,
  });
}

/** Both buyers press the submit button at the same moment; returns each buyer's POST /registration-requests response. */
async function submitTogether(a: Buyer, b: Buyer, mode: FixtureEdition["mode"]) {
  const [first, second] = await Promise.all([submitAndWait(a.page, mode), submitAndWait(b.page, mode)]);
  return [first, second] as const;
}

/** Requests of the edition that still hold or confirm a place (local DB only; remotely the per-buyer API views are the proof). */
function activeRequestsInDb(editionId: string): number {
  return Number(psql(`select count(*) from app.registration_request where edition_id = '${editionId}' and status in ('PENDING_CONFIRMATION', 'CONFIRMED')`));
}

for (const mode of ["EXTERNAL_WHATSAPP", "FREE"] as const) {
  test(`Last slot race (${mode === "FREE" ? "FREE" : "WhatsApp"}): two buyers, capacity 1, exactly one wins`, async ({ browser, baseURL, world, a11y, evidence }) => {
    const edition = await world.createEdition({ key: mode === "FREE" ? "racefree" : "racewa", mode, capacity: 1 });
    const a = await newBuyer(browser, baseURL, "racea");
    const b = await newBuyer(browser, baseURL, "raceb");
    await toReview(a, edition);
    await toReview(b, edition);

    const [responseA, responseB] = await submitTogether(a, b, mode);
    const outcomes = [
      { buyer: a, response: responseA },
      { buyer: b, response: responseB },
    ];
    expect(outcomes.map((outcome) => outcome.response.status()).sort(), "exactly one 201 and one 409").toEqual([201, 409]);
    const winner = outcomes.find((outcome) => outcome.response.status() === 201)!;
    const loser = outcomes.find((outcome) => outcome.response.status() === 409)!;

    // The winner gets what the mode promises.
    const won = await requestData(winner.response);
    expect(won.status).toBe(mode === "FREE" ? "CONFIRMED" : "PENDING_CONFIRMATION");
    await expect(winner.buyer.page.getByTestId("request-outcome")).toBeVisible();

    // The loser is told the slot went, keeps what they typed and sees the true state of that modality.
    expect(((await loser.response.json()) as { error: { code: string } }).error.code).toBe("CAPACITY_UNAVAILABLE");
    const page = loser.buyer.page;
    await expect(page.getByText("Ya no hay cupo disponible para completar esta solicitud.").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
    await expect(page.getByTestId("details-card").getByRole("radio", { name: /^5K/ })).toBeDisabled();
    // A hold only is "temporarily unavailable" (it may come back); confirmed registrations are "sold out".
    await expect(page.getByTestId("details-card").getByText(mode === "FREE" ? "Agotado" : "Temporalmente no disponible").first()).toBeVisible();
    await expect(page.getByTestId("details-card").getByLabel(/Talla de playera/)).toBeVisible();
    await a11y(page);
    await evidence(`race-${mode === "FREE" ? "free" : "wa"}-perdedor`);

    // Each buyer's own list agrees: the winner has one request, the loser none (and the DB, where reachable, holds exactly one).
    const listOf = async (buyer: Buyer) => ((await (await buyer.page.request.get("/api/v1/me/registration-requests")).json()) as { data: unknown[] }).data;
    expect(await listOf(winner.buyer)).toHaveLength(1);
    expect(await listOf(loser.buyer)).toHaveLength(0);
    if (e2eEnv().localDb) expect(activeRequestsInDb(edition.edition_id)).toBe(1);

    await a.context.close();
    await b.context.close();
  });
}

test("Expired hold: the countdown ends without waiting 24 h and the screen offers a NEW request, never the old one", async ({ page, world, evidence, a11y }) => {
  const edition = await world.edition("wa");
  const user = await createReadyUser(page, "expiredclock");
  // The fake clock must exist before the page loads; time still flows normally until it is moved.
  await page.clock.install();
  const request = await requestData((await registerThroughUi(page, edition, { details: { modality: /^5K/, shirt: "M" }, accept: [user.name] }))!);
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByTestId("hold-panel")).toBeVisible();

  // 24 h and a minute later on the device: the countdown (server expires_at against the server-corrected clock) expires by itself.
  await page.clock.fastForward(DAY_MS + 60_000);
  await expect(page.getByRole("heading", { name: "El apartado venció" })).toBeVisible();
  await expect(page.getByTestId("request-outcome")).toHaveAttribute("data-status", "EXPIRED");
  await expect(page.getByTestId("hold-panel")).toHaveCount(0);
  await expect(page.getByRole("timer")).toHaveCount(0);
  await expect(page.locator('a[href^="https://wa.me"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancelar solicitud" })).toHaveCount(0);
  await expect(page.getByText("El lugar anterior no se restaura")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hacer una nueva solicitud" })).toBeVisible();
  await a11y();
  await evidence("expirado-reloj");
  expect(request.expires_at).toBeTruthy();
});

test("Expired hold (server side): the effective expiry shows without the worker and releases the place for the next buyer", async ({ browser, baseURL, world, evidence }) => {
  test.skip(!e2eEnv().localDb, LOCAL_SQL_ONLY);
  const edition = await world.createEdition({ key: "expiredsrv", mode: "EXTERNAL_WHATSAPP", capacity: 1 });
  const holder = await newBuyer(browser, baseURL, "holder");
  const next = await newBuyer(browser, baseURL, "next");

  const held = await requestData((await registerThroughUi(holder.page, edition, { details: { modality: /^5K/, shirt: "M" }, accept: [holder.user.name] }))!);

  // While the hold is live the only 5K place is not available to anybody else.
  await openRegistration(next.page, edition.slug);
  await next.page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(next.page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await expect(next.page.getByTestId("details-card").getByRole("radio", { name: /^5K/ })).toBeDisabled();
  await expect(next.page.getByTestId("details-card").getByText("Temporalmente no disponible").first()).toBeVisible();

  // The hold runs out (SQL fast-forward of the clock-derived columns, local DB only); the worker has NOT run.
  psql(`
    update app.registration_request set created_at = now() - interval '2 days', expires_at = now() - interval '1 hour' where registration_request_id = '${held.registration_request_id}';
    update app.registration_hold set created_at = now() - interval '2 days', expires_at = now() - interval '1 hour' where registration_request_id = '${held.registration_request_id}';
    update app.registration_participant_claim set expires_at = now() - interval '1 hour' where registration_request_id = '${held.registration_request_id}';
  `);
  expect(psql(`select status from app.registration_request where registration_request_id = '${held.registration_request_id}'`)).toBe("PENDING_CONFIRMATION");

  // The holder's own views derive EXPIRED from expires_at and offer a new request.
  await holder.page.goto(`/cuenta/solicitudes/${held.registration_request_id}`);
  await expect(holder.page.getByText("El apartado venció").first()).toBeVisible();
  await expect(holder.page.getByText("Expirada").first()).toBeVisible();
  await expect(holder.page.getByRole("timer")).toHaveCount(0);
  await expect(holder.page.locator('a[href^="https://wa.me"]')).toHaveCount(0);
  await expect(holder.page.getByRole("link", { name: /Hacer una nueva solicitud/ })).toHaveAttribute("href", `/inscripcion/${edition.slug}`);
  await evidence("expirado-servidor-titular");

  // The place came back: the next buyer registers into it.
  const retry = await requestData((await registerThroughUi(next.page, edition, { details: { modality: /^5K/, shirt: "L" }, accept: [next.user.name] }))!);
  expect(retry.status).toBe("PENDING_CONFIRMATION");

  // And the holder, whose old request expired, may start a new one (it finds no free 5K place, but is not blocked by the expired request).
  await openRegistration(holder.page as Page, edition.slug);
  await expect(holder.page.getByTestId("existing-registrations")).toHaveCount(0);
  await holder.context.close();
  await next.context.close();
});
