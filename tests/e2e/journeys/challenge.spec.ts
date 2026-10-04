import type { Page, Request } from "@playwright/test";
import { createReadyUser, psql } from "../support/account";
import { e2eEnv } from "../support/env";
import {
  LOCAL_SQL_ONLY,
  expect,
  registerSelfViaApi,
  registerThroughUi,
  requestData,
  skipWithoutFixtureAdmin,
  submitAndWait,
  test,
} from "../support/journey";

// P3-D2 (OD-P2-01, P3-AC-13 participant side): an EXTERNAL_WHATSAPP request from an account younger than 24 h needs a solved ALTCHA
// challenge; FREE Editions and older accounts never see it. The server decides: the review step probes
// GET /registration-requests/challenge, solves in the browser only when `required`, and sends the payload as `altcha` in the same
// POST. Every journey of this file uses a FRESH account on purpose (createReadyUser(..., { fresh: true })); every other journey backdates
// its fixture accounts locally (support/account.ts `ageFixtureAccount`), so nothing else is challenged.
test.describe.configure({ timeout: 240_000 });
test.beforeEach(() => skipWithoutFixtureAdmin());

const DETAILS = { modality: /^5K/, shirt: "M" } as const;
const CHALLENGE_PATH = "/api/v1/registration-requests/challenge";
const isCreate = (request: Request) => request.url().endsWith("/api/v1/registration-requests") && request.method() === "POST";
const isProbe = (request: Request) => request.url().includes(CHALLENGE_PATH) && request.method() === "GET";

function creates(page: Page): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (isCreate(request)) seen.push(request);
  });
  return seen;
}

function probes(page: Page): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (isProbe(request)) seen.push(request);
  });
  return seen;
}

const bodyOf = (request: Request) => JSON.parse(request.postData() ?? "{}") as { altcha?: string };
const keyOf = (request: Request) => request.headers()["idempotency-key"];

async function ageOf(email: string): Promise<number> {
  const hours = psql(`select extract(epoch from (now() - created_at)) / 3600 from auth.users where lower(email) = lower('${email}')`);
  return Number.parseFloat(hours);
}

test("New account on a WhatsApp Edition passes the challenge and the request is created", async ({ page, world, a11y, evidence }) => {
  const edition = await world.edition("wa");
  const user = await createReadyUser(page, "newwa", undefined, { fresh: true });
  if (e2eEnv().localDb) expect(await ageOf(user.email), "the account must still be new").toBeLessThan(1);
  const sentCreates = creates(page);
  const sentProbes = probes(page);

  await registerThroughUi(page, edition, { details: DETAILS, accept: [user.name], stopAtReview: true });

  // Verification runs by itself: an accessible status (polite live region) goes from "Verificando" to "Verificación lista".
  const panel = page.getByTestId("captcha-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Confirma que eres una persona para enviar tu solicitud" })).toBeVisible();
  const status = panel.getByRole("status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText("Verificación lista", { timeout: 30_000 });
  const submit = page.getByRole("button", { name: "Apartar mis lugares" });
  await expect(submit).toBeEnabled();
  expect(sentProbes.length, "the probe happens before the submit, once").toBe(1);
  expect(sentCreates, "nothing was created while verifying").toHaveLength(0);
  await a11y();
  await evidence("challenge-listo");

  const request = await requestData(await submitAndWait(page, "EXTERNAL_WHATSAPP"));
  expect(request.status).toBe("PENDING_CONFIRMATION");
  expect(sentCreates, "one attempt: the probe spared the 5-per-10-minutes creation limit").toHaveLength(1);
  expect(bodyOf(sentCreates[0]).altcha, "the solved payload rides in the same body").toEqual(expect.any(String));
  await expect(page.getByRole("heading", { name: "Tus lugares están apartados" })).toBeVisible();

  // The solution is single use and never kept: not in the browser storage of the tab.
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain(bodyOf(sentCreates[0]).altcha!);
});

test("An established account and a FREE Edition never see or solve a challenge", async ({ page, browser, baseURL, world, a11y }) => {
  const wa = await world.edition("wa");
  const free = await world.edition("free");
  const user = await createReadyUser(page, "oldwa");
  const sentCreates = creates(page);

  // WhatsApp, account older than 24 h locally: the probe answers "not required" (the server decides), no panel, no payload.
  // Remote targets cannot age accounts, so there the same account is challenged: this half only asserts the locally aged case.
  if (e2eEnv().localDb) {
    const probe = page.waitForResponse((response) => response.url().includes(CHALLENGE_PATH));
    await registerThroughUi(page, wa, { details: DETAILS, accept: [user.name], stopAtReview: true });
    const answer = (await (await probe).json()) as { data: { applies: boolean; required: boolean; challenge: unknown } };
    expect(answer.data).toMatchObject({ applies: false, required: false, challenge: null });
    await expect(page.getByTestId("captcha-panel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Apartar mis lugares" })).toBeEnabled();
    await a11y();
    await requestData(await submitAndWait(page, "EXTERNAL_WHATSAPP"));
    expect(bodyOf(sentCreates[0])).not.toHaveProperty("altcha");
  }

  // FREE, with a brand-new account (the strongest case): the review step does not even ask the server about a challenge.
  // Its own browser context, so signing in another account never races the page of the previous journey half.
  const freeContext = await browser.newContext({ baseURL });
  const freePage = await freeContext.newPage();
  const freeCreates = creates(freePage);
  const freeProbes = probes(freePage);
  const freeUser = await createReadyUser(freePage, "freeold", undefined, { fresh: true });
  await registerThroughUi(freePage, free, { details: DETAILS, accept: [freeUser.name], stopAtReview: true });
  await expect(freePage.getByRole("button", { name: "Confirmar inscripción" })).toBeEnabled();
  await expect(freePage.getByTestId("captcha-panel")).toHaveCount(0);
  expect(freeProbes, "FREE never probes").toHaveLength(0);
  await requestData(await submitAndWait(freePage, "FREE"));
  expect(bodyOf(freeCreates[0])).not.toHaveProperty("altcha");
  await freeContext.close();
});

test("An invalid challenge shows the error state, a fresh one is prepared and the retry works with the same key", async ({ page, world, evidence }) => {
  test.skip(!e2eEnv().localDb, LOCAL_SQL_ONLY);
  const edition = await world.edition("wa");
  const user = await createReadyUser(page, "badaltcha", undefined, { fresh: true });
  const sentCreates = creates(page);

  await registerThroughUi(page, edition, { details: DETAILS, accept: [user.name], stopAtReview: true });
  await expect(page.getByTestId("captcha-panel").getByRole("status")).toContainText("Verificación lista", { timeout: 30_000 });

  // The first submit carries a tampered solution (a wrong number): the server answers captcha_invalid and hands back a fresh challenge.
  let tampered = true;
  await page.route("**/api/v1/registration-requests", async (route) => {
    const request = route.request();
    if (!tampered || request.method() !== "POST") return route.continue();
    tampered = false;
    const body = JSON.parse(request.postData() ?? "{}") as { altcha: string };
    const payload = JSON.parse(Buffer.from(body.altcha, "base64").toString("utf8")) as { number: number };
    payload.number += 1;
    return route.continue({ postData: JSON.stringify({ ...body, altcha: Buffer.from(JSON.stringify(payload)).toString("base64") }) });
  });
  const rejected = page.waitForResponse((response) => response.url().endsWith("/api/v1/registration-requests") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Apartar mis lugares" }).click();
  const refusal = await rejected;
  expect(refusal.status()).toBe(422);
  expect(((await refusal.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("captcha_invalid");

  // The error state is explicit and Spanish, nothing entered is lost, and the panel verifies again by itself with the fresh challenge.
  await expect(page.getByText("La verificación no es válida o expiró. Inténtalo de nuevo.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  await expect(page.getByTestId("captcha-panel").getByRole("status")).toContainText("Verificación lista", { timeout: 30_000 });
  await evidence("challenge-invalido");

  const created = await submitAndWait(page, "EXTERNAL_WHATSAPP");
  expect((await requestData(created)).status).toBe("PENDING_CONFIRMATION");
  expect(sentCreates).toHaveLength(2);
  expect(keyOf(sentCreates[1]), "one user action, one Idempotency-Key").toBe(keyOf(sentCreates[0]));
  expect(bodyOf(sentCreates[1]).altcha, "a challenge is single use: the retry carries a fresh solution").not.toBe(bodyOf(sentCreates[0]).altcha);
});

test("A page that skipped the probe is rescued by the 422: it solves the challenge it carries and resubmits with the same key", async ({ page, world, evidence }) => {
  test.skip(!e2eEnv().localDb, LOCAL_SQL_ONLY);
  const edition = await world.edition("wa");
  const user = await createReadyUser(page, "stalewa", undefined, { fresh: true });
  const sentCreates = creates(page);

  // A stale page believes no challenge is needed (probe answered "not required"); the server disagrees at submit.
  await page.route(`**${CHALLENGE_PATH}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { applies: true, required: false, has_clearance: false, new_account_hours: 24, challenge: null }, meta: {} }),
    }),
  );
  await registerThroughUi(page, edition, { details: DETAILS, accept: [user.name], stopAtReview: true });
  await expect(page.getByTestId("captcha-panel")).toHaveCount(0);

  const created = await submitAndWait(page, "EXTERNAL_WHATSAPP");
  await expect.poll(() => sentCreates.length, { timeout: 30_000 }).toBe(2);
  expect(created.status()).toBe(422);
  expect(((await created.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("captcha_required");
  await expect(page.getByRole("heading", { name: "Tus lugares están apartados" })).toBeVisible({ timeout: 30_000 });
  expect(bodyOf(sentCreates[0])).not.toHaveProperty("altcha");
  expect(bodyOf(sentCreates[1]).altcha).toEqual(expect.any(String));
  expect(keyOf(sentCreates[1])).toBe(keyOf(sentCreates[0]));
  await evidence("challenge-rescate-422");
});

test("The challenge is operable with the keyboard alone and keeps the continue button honest", async ({ page, world }) => {
  const edition = await world.edition("wa");
  const user = await createReadyUser(page, "kbdaltcha", undefined, { fresh: true });
  await registerThroughUi(page, edition, { details: DETAILS, accept: [user.name], stopAtReview: true });
  const submit = page.getByRole("button", { name: "Apartar mis lugares" });
  await expect(page.getByTestId("captcha-panel").getByRole("status")).toContainText("Verificación lista", { timeout: 30_000 });
  await submit.focus();
  const sent = creates(page);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/v1/registration-requests") && response.request().method() === "POST");
  await page.keyboard.press("Enter");
  expect((await requestData(await created)).status).toBe("PENDING_CONFIRMATION");
  expect(sent).toHaveLength(1);
});

test("The API path honours the same contract: a fresh account probes, solves and sends `altcha`,", async ({ page, world }) => {
  const edition = await world.edition("wa");
  await createReadyUser(page, "apialtcha", undefined, { fresh: true });
  const context = ((await (await page.request.get(`/api/v1/events/${edition.slug}/registration-context`)).json()) as { data: { edition: { edition_id: string } } }).data;

  // The probe is how the harness (and a remote run, where accounts cannot be aged) knows a challenge is due.
  const probe = ((await (await page.request.get(`/api/v1/registration-requests/challenge?edition_id=${context.edition.edition_id}`)).json()) as { data: { applies: boolean; required: boolean } }).data;
  expect(probe).toMatchObject({ applies: true, required: true });

  // registerSelfViaApi is the helper every API-driven journey uses: it solves the challenge itself when (and only when) the server asks.
  const request = await registerSelfViaApi(page, edition.slug);
  expect(request.status).toBe("PENDING_CONFIRMATION");
});
