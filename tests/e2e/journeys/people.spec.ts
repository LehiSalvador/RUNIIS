import { birthDateForAge, createReadyUser, signInViaApi, uniqueEmail } from "../support/account";
import { settleNetwork } from "../support/settle";
import {
  acceptEventDocuments,
  befriend,
  chooseParticipants,
  continueButton,
  expect,
  fillDetails,
  guestPayload,
  newBuyer,
  openRegistration,
  registerThroughUi,
  requestData,
  skipWithoutFixtureAdmin,
  submitAndWait,
  test,
} from "../support/journey";

// Phase 2 participant journeys (Roadmap 8.22), part 2: the people a buyer can register besides themself.
// Friend (adult, accepts personally), Guest (owned, no credit language), Minor 15-17 with a guardian, and the
// refusals (a minor without a guardian, under 15). Event documents are accepted per participant by whoever may.
test.describe.configure({ timeout: 300_000 });
test.beforeEach(() => skipWithoutFixtureAdmin());

type PendingAction = { subject: { kind: string }; edition: { edition_id: string }; documents: { legal_document_version_id: string; document_type: string }[] };

async function pendingActionsFor(page: import("@playwright/test").Page, editionId: string): Promise<PendingAction[]> {
  const response = await page.request.get(`/api/v1/me/pending-actions?edition_id=${editionId}`);
  expect(response.status(), "pending actions").toBe(200);
  return ((await response.json()) as { data: PendingAction[] }).data;
}

test("Friend (FREE): the adult Friend accepts their own documents; the buyer cannot accept for them", async ({ page, browser, baseURL, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const buyer = await createReadyUser(page, "friendbuyer");
  const friend = await newBuyer(browser, baseURL, "friend");
  await befriend(page, friend.page, friend.user);

  await openRegistration(page, edition.slug);
  const friendRow = page.getByTestId("candidate-row").filter({ hasText: friend.user.name });
  await expect(friendRow).toContainText("Amistad");
  await chooseParticipants(page, [new RegExp(friend.user.name)]);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await fillDetails(page, null, { modality: /^5K/, shirt: "M" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();

  // The buyer ticks their own documents only; the Friend's card has no checkbox and says who has to accept.
  expect(await acceptEventDocuments(page, buyer.name)).toBeGreaterThan(0);
  const friendCard = page.getByTestId("legal-card").filter({ hasText: friend.user.name });
  await expect(friendCard.getByRole("checkbox")).toHaveCount(0);
  await expect(friendCard.getByTestId("pending-other")).toContainText(`Pendiente de aceptación de ${friend.user.name}`);
  await expect(friendCard.getByTestId("pending-other")).toContainText("Nadie puede aceptar por otra persona adulta");
  await evidence("friend-free-pendiente");

  // FREE confirms instantly, so the buyer cannot go on until the Friend has accepted.
  await continueButton(page).click();
  await expect(page.getByTestId("step-error")).toContainText("deben aceptar sus documentos desde su cuenta");
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();

  // The Friend accepts in their own account through the pending-actions contract.
  const actions = await pendingActionsFor(friend.page, edition.edition_id);
  const own = actions.find((action) => action.subject.kind === "SELF" && action.edition.edition_id === edition.edition_id);
  expect(own, "the Friend is told what to accept").toBeTruthy();
  const accepted = await friend.page.request.post("/api/v1/me/pending-actions/accept-documents", {
    data: { edition_id: edition.edition_id, legal_document_version_ids: own!.documents.map((document) => document.legal_document_version_id) },
  });
  expect(accepted.status(), "Friend accepts their own documents").toBeLessThan(300);
  expect(await pendingActionsFor(friend.page, edition.edition_id)).toEqual([]);

  // The buyer refreshes: the Friend now shows as accepted and the request can be sent.
  await friendCard.getByRole("button", { name: /Ya aceptó, actualizar/ }).click();
  await expect(friendCard.getByTestId("pending-other")).toHaveCount(0, { timeout: 20_000 });
  await expect(friendCard).toContainText("aceptado");
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  await expect(page.getByTestId("review-row").filter({ hasText: friend.user.name })).toContainText("Documentos del evento aceptados");
  const request = await requestData(await submitAndWait(page, "FREE"));

  expect(request.status).toBe("CONFIRMED");
  expect(request.participants).toHaveLength(2);
  expect(request.participants.map((participant) => participant.legal_acceptance_status)).toEqual(["ACCEPTED", "ACCEPTED"]);
  // The buyer gets a pass id for themself only; the Friend sees theirs in their own account.
  expect(request.participants.filter((participant) => participant.registration?.participant_pass_id)).toHaveLength(1);
  await expect(page.getByRole("heading", { name: /Tu inscripción está confirmada/ })).toBeVisible();
  await a11y();

  await friend.page.goto("/cuenta/pases");
  await settleNetwork(friend.page);
  await expect(friend.page.getByTestId("pass-row").first()).toHaveAttribute("data-pass-state", "VALID");
  await friend.context.close();
});

test("Friend (WhatsApp): the request is created, staff cannot confirm until the Friend accepts in their account", async ({ page, browser, baseURL, world, a11y, evidence }) => {
  const edition = await world.edition("wa");
  const buyer = await createReadyUser(page, "friendwabuyer");
  const friend = await newBuyer(browser, baseURL, "friendwa");
  await befriend(page, friend.page, friend.user);

  const response = await registerThroughUi(page, edition, {
    people: [new RegExp(friend.user.name)],
    details: { modality: /^5K/, shirt: "L" },
    accept: [buyer.name],
  });
  const request = await requestData(response!);
  expect(request.status).toBe("PENDING_CONFIRMATION");
  const byName = (name: string) => request.participants.find((participant) => participant.display_name === name)!;
  expect(byName(buyer.name).legal_acceptance_status).toBe("ACCEPTED");
  expect(byName(friend.user.name).legal_acceptance_status).toBe("PENDING");
  await expect(page.getByRole("heading", { name: "Tus lugares están apartados" })).toBeVisible();

  // Staff cannot confirm while the Friend has not accepted.
  const early = await world.staff.confirmRequest(request.registration_request_id);
  expect(early.ok, "confirmation before the Friend accepted").toBe(false);

  // The Friend's own account lists the pending action and accepts it through the UI.
  await friend.page.goto("/cuenta");
  await settleNetwork(friend.page);
  const action = friend.page.getByTestId("pending-action");
  await expect(action).toContainText(`Acepta los documentos de ${edition.name}`);
  await action.getByRole("button", { name: "Revisar y aceptar" }).click();
  const dialog = friend.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Aceptar documentos" }).click();
  await expect(dialog.getByText("Marca la casilla para confirmar que leíste los documentos.")).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Leí y acepto estos documentos" }).click();
  await evidence("friend-wa-aceptar");
  await dialog.getByRole("button", { name: "Aceptar documentos" }).click();
  await expect(friend.page.getByText("Documentos aceptados").first()).toBeVisible();
  await expect(friend.page.getByTestId("pending-action")).toHaveCount(0);

  // Now staff can confirm, and each person ends with their own pass.
  const confirmed = await world.staff.confirmRequest(request.registration_request_id);
  expect(confirmed, "confirmation after the Friend accepted").toEqual({ ok: true, refusal: null });
  await page.goto(`/cuenta/solicitudes/${request.registration_request_id}`);
  await expect(page.getByText("Confirmada").first()).toBeVisible();
  await a11y();
  await friend.page.goto("/cuenta/pases");
  await settleNetwork(friend.page);
  await expect(friend.page.getByTestId("pass-row").first()).toHaveAttribute("data-pass-state", "VALID");
  await friend.context.close();
});

test("Guest: owned by the buyer, accepted per participant, no credit language, pass held by the owner", async ({ page, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const owner = await createReadyUser(page, "guestowner");
  const guestName = `Invitado Journey ${Math.random().toString(36).slice(2, 6)}`;
  const created = await page.request.post("/api/v1/me/guests", { data: guestPayload(guestName, "1994-05-05") });
  expect(created.status(), "create Guest").toBe(201);

  await openRegistration(page, edition.slug);
  const guestRow = page.getByTestId("candidate-row").filter({ hasText: guestName });
  await expect(guestRow).toContainText("Invitado");
  await chooseParticipants(page, [new RegExp(guestName)]);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await fillDetails(page, null, { modality: /^5K/, shirt: "M" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();

  // Event documents are accepted per participant: the owner ticks their own AND, as owner, the Guest's.
  const ownCount = await acceptEventDocuments(page, owner.name);
  const guestCard = page.getByTestId("legal-card").filter({ hasText: guestName });
  await expect(guestCard.getByRole("checkbox").first()).toHaveAccessibleName(new RegExp(`Acepto por ${guestName}`));
  const guestCount = await acceptEventDocuments(page, guestName);
  expect(ownCount).toBeGreaterThan(0);
  expect(guestCount).toBeGreaterThan(0);
  await evidence("guest-legal");
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  const created2 = page.waitForRequest((request) => request.url().endsWith("/api/v1/registration-requests") && request.method() === "POST");
  const response = await submitAndWait(page, "FREE");
  const sent = (await created2).postDataJSON() as { legal_acceptances: { participant_index: number; legal_document_version_id: string }[] };
  const request = await requestData(response);

  // One acceptance per document and per participant (index 0 and 1), never one shared tick.
  const perParticipant = [0, 1].map((index) => sent.legal_acceptances.filter((entry) => entry.participant_index === index).length);
  expect(perParticipant).toEqual([ownCount, guestCount]);
  expect(request.participants).toHaveLength(2);
  expect(request.participants.map((participant) => participant.legal_acceptance_status)).toEqual(["ACCEPTED", "ACCEPTED"]);
  expect(request.participants.filter((participant) => participant.registration?.participant_pass_id)).toHaveLength(2);

  // A Guest is a person registered by the owner: nothing in the confirmation talks about credits or balances.
  await expect(page.getByRole("heading", { name: /Tu inscripción está confirmada/ })).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/cr[eé]dit|saldo|cup[oó]n|prepag|ticket/i);
  await a11y();

  // The owner holds both passes: theirs and the Guest's.
  await page.goto("/cuenta/pases");
  await settleNetwork(page);
  await expect(page.getByRole("heading", { name: "Pases de tus invitados" })).toBeVisible();
  await expect(page.getByTestId("pass-row").filter({ hasText: `Pase de ${guestName}` })).toHaveAttribute("data-pass-state", "VALID");
  await expect(page.getByTestId("pass-row").filter({ hasText: "Tu pase" })).toHaveAttribute("data-pass-state", "VALID");
});

test("Minor 15-17 with an ACTIVE guardian: the guardian registers them and accepts the three documents for them", async ({ page, browser, baseURL, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const guardian = await createReadyUser(page, "guardian");
  const minor = await newBuyer(browser, baseURL, "minor", { date_of_birth: birthDateForAge(16) });

  // The minor asks the adult to be a friend and then to be their guardian; the adult confirms both (API: the UI flow is account/people.spec).
  await befriend(minor.page, page, guardian);
  const link = await minor.page.request.post("/api/v1/me/guardians", {
    data: { minor_kind: "RUNNER", counterpart_public_profile_id: guardian.publicProfileId, relationship_type: "PARENT" },
  });
  expect(link.status(), "guardian request").toBeLessThan(300);
  const assignment = ((await link.json()) as { data: { guardian_assignment_id: string } }).data.guardian_assignment_id;
  const confirm = await page.request.post(`/api/v1/me/guardians/${assignment}/confirm`);
  expect(confirm.status(), "guardian confirm").toBeLessThan(300);

  await openRegistration(page, edition.slug);
  const minorRow = page.getByTestId("candidate-row").filter({ hasText: minor.user.name });
  await expect(minorRow).toContainText("Menor de edad");
  await chooseParticipants(page, [new RegExp(minor.user.name)]);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await fillDetails(page, null, { modality: /^5K/, shirt: "S" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();

  // The minor owes one more document than an adult (MINOR_TERMS), and the guardian is the one who accepts it.
  const adultCard = page.getByTestId("legal-card").filter({ hasText: guardian.name });
  const minorCard = page.getByTestId("legal-card").filter({ hasText: minor.user.name });
  const adultDocs = await adultCard.getByRole("checkbox").count();
  const minorDocs = await minorCard.getByRole("checkbox").count();
  expect(minorDocs).toBe(adultDocs + 1);
  await expect(minorCard.getByRole("checkbox").first()).toHaveAccessibleName(new RegExp(`Acepto como responsable de ${minor.user.name}`));
  await expect(minorCard).toContainText("Aceptas como responsable");
  await acceptEventDocuments(page, guardian.name);
  await acceptEventDocuments(page, minor.user.name);
  await evidence("minor-guardian-legal");
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  const request = await requestData(await submitAndWait(page, "FREE"));
  expect(request.status).toBe("CONFIRMED");
  expect(request.participants.map((participant) => participant.legal_acceptance_status)).toEqual(["ACCEPTED", "ACCEPTED"]);
  await expect(page.getByRole("heading", { name: /Tu inscripción está confirmada/ })).toBeVisible();
  await a11y();

  // The minor's own account holds their pass.
  await minor.page.goto("/cuenta/pases");
  await settleNetwork(minor.page);
  await expect(minor.page.getByTestId("pass-row").first()).toHaveAttribute("data-pass-state", "VALID");
  await minor.context.close();
});

test("Minor without a guardian and under 15 are refused: the builder blocks, the server agrees", async ({ page, browser, baseURL, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const minor = await createReadyUser(page, "minorsolo", { date_of_birth: birthDateForAge(16) });

  // The builder offers the minor but disabled, with the reason tied to the control, and nobody can continue.
  await openRegistration(page, edition.slug);
  const selfRow = page.getByTestId("candidate-row").filter({ hasText: minor.name });
  await expect(selfRow.getByRole("checkbox")).toBeDisabled();
  await expect(selfRow).toContainText("adulto responsable");
  await expect(page.getByText("Nadie puede inscribirse por ahora.")).toBeVisible();
  await continueButton(page).click();
  await expect(page.getByTestId("step-error")).toBeVisible();
  await expect(page.getByRole("heading", { name: "¿Quién se inscribe?" })).toBeVisible();
  await a11y();
  await evidence("minor-sin-tutor");

  // The server is the authority: sending the registration anyway is refused with GUARDIAN_REQUIRED.
  const contextResponse = await page.request.get(`/api/v1/events/${edition.slug}/registration-context`);
  const context = ((await contextResponse.json()) as { data: { edition: { edition_id: string }; modalities: { modality_id: string }[]; candidates: { public_profile_id: string }[] } }).data;
  const forced = await page.request.post("/api/v1/registration-requests", {
    data: {
      edition_id: context.edition.edition_id,
      participants: [{ kind: "PROFILE", public_profile_id: context.candidates[0].public_profile_id, modality_id: context.modalities[0].modality_id, responses: { shirt_size: "M" } }],
      legal_acceptances: [],
    },
    headers: { "Idempotency-Key": `qa-e2e-minor-${Date.now()}` },
  });
  expect(forced.status()).toBe(422);
  expect(((await forced.json()) as { error: { code: string } }).error.code).toBe("GUARDIAN_REQUIRED");

  // An owned minor Guest without a guardian is the same: listed, disabled, with the reason.
  const adult = await newBuyer(browser, baseURL, "minorguestowner");
  const guestName = `Invitada Menor ${Math.random().toString(36).slice(2, 6)}`;
  expect((await adult.page.request.post("/api/v1/me/guests", { data: guestPayload(guestName, birthDateForAge(16)) })).status()).toBe(201);
  await openRegistration(adult.page, edition.slug);
  const guestRow = adult.page.getByTestId("candidate-row").filter({ hasText: guestName });
  await expect(guestRow.getByRole("checkbox")).toBeDisabled();
  await expect(guestRow).toContainText("adulto responsable");

  // Under 15 never gets this far: a Guest is refused at creation and an account cannot become READY.
  const under15 = await adult.page.request.post("/api/v1/me/guests", { data: guestPayload("Invitado Menor de 15", birthDateForAge(14)) });
  expect(under15.status()).toBe(400);
  await adult.context.close();

  const younger = await browser.newContext({ baseURL });
  const youngerPage = await younger.newPage();
  await signInViaApi(youngerPage.request, uniqueEmail("under15"));
  const onboarding = await youngerPage.request.post("/api/v1/me/onboarding", {
    data: {
      full_name: "Persona Menor de 15",
      date_of_birth: birthDateForAge(14),
      sex_code: "F",
      phone_e164: "+528110001234",
      emergency_contact_name: "Contacto Sintetico",
      emergency_contact_phone_e164: "+528110005678",
      emergency_contact_relationship: "Madre",
    },
  });
  expect(onboarding.status()).toBeGreaterThanOrEqual(400);
  expect(onboarding.status()).toBeLessThan(500);
  const blocked = await youngerPage.request.get(`/api/v1/events/${edition.slug}/registration-context`);
  expect(blocked.status()).toBe(422);
  expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("PROFILE_INCOMPLETE");
  await younger.close();
});
