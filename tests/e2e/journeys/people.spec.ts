import { birthDateForAge, createReadyUser, postOnboarding, signInViaApi, uniqueEmail } from "../support/account";
import { settleNetwork } from "../support/settle";
import {
  acceptEventDocuments,
  acceptOnEditionScreen,
  befriend,
  chooseParticipants,
  continueButton,
  copyAcceptanceLink,
  expect,
  fillDetails,
  guestPayload,
  newBuyer,
  openEditionDocuments,
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

  // The buyer copies the deep link; the Friend opens it in their own account and accepts on the edition documents screen.
  const link = await copyAcceptanceLink(page, friendCard);
  expect(new URL(link).pathname).toBe(`/cuenta/documentos/evento/${edition.slug}`);
  const own = (await pendingActionsFor(friend.page, edition.edition_id)).find((action) => action.subject.kind === "SELF");
  expect(own, "the Friend is told what to accept").toBeTruthy();
  await openEditionDocuments(friend.page, link);
  const screen = friend.page.getByTestId("edition-documents");
  await expect(screen.getByRole("heading", { name: edition.name })).toBeVisible();
  const cards = friend.page.getByTestId("edition-docs-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Tus documentos");
  await expect(cards.first().getByRole("checkbox")).toHaveCount(own!.documents.length);
  await a11y(friend.page);
  await evidence("friend-free-deep-link");
  await acceptOnEditionScreen(cards.first());
  await expect(friend.page.getByTestId("edition-docs-done")).toContainText("Aceptaste tus documentos");
  await expect(friend.page.getByText(/Ya aceptó, actualizar/)).toBeVisible();
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

test("Guardian of a minor Guest owned by another account (FREE): the buyer copies the link, the guardian accepts on the screen, the owner's submit confirms", async ({ page, browser, baseURL, world, a11y, evidence }) => {
  const edition = await world.edition("free");
  const owner = await createReadyUser(page, "guestguardianowner");
  const guardian = await newBuyer(browser, baseURL, "guestguardian");
  await befriend(page, guardian.page, guardian.user);

  // A minor Guest (16) owned by the buyer whose guardian is the adult Friend: the Friend confirms the link from their own account.
  const guestName = `Menor Journey ${Math.random().toString(36).slice(2, 6)}`;
  const created = await page.request.post("/api/v1/me/guests", { data: guestPayload(guestName, birthDateForAge(16)) });
  expect(created.status(), "create minor Guest").toBe(201);
  const guestId = ((await created.json()) as { data: { guest_participant_id: string } }).data.guest_participant_id;
  const linked = await page.request.post("/api/v1/me/guardians", {
    data: { minor_kind: "GUEST", guest_participant_id: guestId, guardian_public_profile_id: guardian.user.publicProfileId, relationship_type: "PARENT" },
  });
  expect(linked.status(), "guardian request for the Guest").toBeLessThan(300);
  const assignment = ((await linked.json()) as { data: { guardian_assignment_id: string } }).data.guardian_assignment_id;
  expect((await guardian.page.request.post(`/api/v1/me/guardians/${assignment}/confirm`)).status(), "guardian confirm").toBeLessThan(300);

  await openRegistration(page, edition.slug);
  await chooseParticipants(page, [new RegExp(guestName)]);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Modalidad y datos" })).toBeVisible();
  await fillDetails(page, null, { modality: /^5K/, shirt: "S" });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Documentos legales" })).toBeVisible();

  // The owner accepts only their own; the minor's documents belong to the guardian, who is another account.
  expect(await acceptEventDocuments(page, owner.name)).toBeGreaterThan(0);
  const guestCard = page.getByTestId("legal-card").filter({ hasText: guestName });
  await expect(guestCard.getByRole("checkbox")).toHaveCount(0);
  await expect(guestCard.getByTestId("pending-other")).toContainText("su responsable es otra persona");
  await continueButton(page).click();
  await expect(page.getByTestId("step-error")).toContainText("deben aceptar sus documentos desde su cuenta");

  // No request exists yet: the deep link is how the guardian learns what to accept.
  const deepLink = await copyAcceptanceLink(page, guestCard);
  expect(new URL(deepLink).pathname).toBe(`/cuenta/documentos/evento/${edition.slug}`);
  await openEditionDocuments(guardian.page, deepLink);
  const cards = guardian.page.getByTestId("edition-docs-card");
  const wardCard = cards.filter({ hasText: guestName });
  await expect(wardCard).toHaveCount(1);
  await expect(wardCard).toContainText("Aceptas como su responsable");
  // The guardian's own adult documents are listed too (they are an adult in this edition), and never anyone else's ward.
  const ownCard = cards.filter({ hasText: "Tus documentos" });
  await expect(ownCard).toHaveCount(1);
  await expect(cards).toHaveCount(2);
  expect(await wardCard.getByRole("checkbox").count(), "the minor owes one more document than an adult").toBe((await ownCard.getByRole("checkbox").count()) + 1);
  await expect(wardCard.getByRole("checkbox").first()).toHaveAccessibleName(/Leí y acepto como responsable/);
  await a11y(guardian.page);
  await evidence("guardian-guest-deep-link");
  await acceptOnEditionScreen(wardCard);
  await expect(guardian.page.getByTestId("edition-docs-done").filter({ hasText: guestName })).toContainText(`Aceptaste los documentos de ${guestName}`);

  // The owner refreshes, the FREE submit confirms and holds both passes.
  await guestCard.getByRole("button", { name: /Ya aceptó, actualizar/ }).click();
  await expect(guestCard.getByTestId("pending-other")).toHaveCount(0, { timeout: 20_000 });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Revisa y envía" })).toBeVisible();
  const request = await requestData(await submitAndWait(page, "FREE"));
  expect(request.status).toBe("CONFIRMED");
  expect(request.participants.map((participant) => participant.legal_acceptance_status)).toEqual(["ACCEPTED", "ACCEPTED"]);
  expect(request.participants.filter((participant) => participant.registration?.participant_pass_id)).toHaveLength(2);
  await expect(page.getByRole("heading", { name: /Tu inscripción está confirmada/ })).toBeVisible();
  await a11y();

  // The owner is not the guardian: the same screen never offers the minor's documents to them.
  await openEditionDocuments(page, deepLink);
  await expect(page.getByTestId("edition-docs-card").filter({ hasText: guestName })).toHaveCount(0);
  await expect(page.getByTestId("edition-docs-done")).toHaveCount(0);
  await guardian.context.close();
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
  // The Edition's own rules have a per-Edition document key: the dialog reads them by that key, not by the document type.
  await expect(dialog.getByText(new RegExp(`reglamento ${edition.slug}`))).toBeVisible();
  await expect(dialog.getByText("Este documento no está disponible para lectura aquí")).toHaveCount(0);
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
  // Current legal ids are sent (postOnboarding), so the only thing wrong with this request is the age: the stable
  // age rule answers, not the "legal_document_version_ids required" 400.
  const onboarding = await postOnboarding(youngerPage.request, {
    full_name: "Persona Menor de 15",
    date_of_birth: birthDateForAge(14),
    sex_code: "F",
    phone_e164: "+528110001234",
    emergency_contact_name: "Contacto Sintetico",
    emergency_contact_phone_e164: "+528110005678",
    emergency_contact_relationship: "Madre",
  });
  expect(onboarding.status()).toBe(400);
  const rejection = ((await onboarding.json()) as { error: { code: string; details?: { field?: string; reason?: string } } }).error;
  expect(rejection.code).toBe("VALIDATION_ERROR");
  expect(rejection.details).toMatchObject({ field: "date_of_birth", reason: "UNDER_MIN_AGE" });
  const blocked = await youngerPage.request.get(`/api/v1/events/${edition.slug}/registration-context`);
  expect(blocked.status()).toBe(422);
  expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("PROFILE_INCOMPLETE");
  await younger.close();
});
