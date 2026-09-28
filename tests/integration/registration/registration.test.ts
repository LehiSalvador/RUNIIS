import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AppError } from "@/lib/server/http/errors";
import { acceptEditionDocuments, cancelRegistrationRequest, confirmRegistrationRequest, createRegistrationRequest, getRegistrationRequest, listMyPendingActions, revalidateAndConfirmRegistrationRequest, staffCancelRegistrationRequest } from "@/lib/server/domain/registration/service";
import { createGuest, requestFriendship, respondFriendship } from "@/lib/server/domain/people/service";
import { getMyPass, renderMyPassQrSvg, replacePassCredential } from "@/lib/server/domain/passes/service";
import { cleanup, createTestStaff, createTestUser, queryValue, sql, type TestStaff, type TestUser } from "../helpers";
import { buildEdition, currentLegalVersionId, ensureGlobalLegalDocumentsPublished, selfAcceptance } from "./helpers";

// Exercises the registration/passes domain end to end against the real local Postgres + RLS,
// driving the domain/service layer directly (the HTTP route layer is generic and covered by pgTAP
// 400/410 for the RPC contract, and by tests/unit for the handler wiring). Master §61-84/§124/§206.

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await promise.catch((error: AppError) => expect(error.code).toBe(code));
}

async function expectAppErrorReason(promise: Promise<unknown>, code: string, reason: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await promise.catch((error: AppError) => {
    expect(error.code).toBe(code);
    expect(error.details.reason).toBe(reason);
  });
}

/** Backdates both created_at and expires_at so expires_at < now() while created_at < expires_at holds
 * (registration_request_expiry_after_creation), simulating a past-expiry request without the worker. */
function backdateExpiry(registrationRequestId: string): void {
  sql(`update app.registration_request set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
       where registration_request_id = '${registrationRequestId}'`);
}

describe("registration/passes domain (T34) integration", () => {
  let admin: TestStaff;
  const users: TestUser[] = [];
  const authUserIds: string[] = [];

  beforeAll(async () => {
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
  }, 30_000);

  afterAll(async () => {
    await cleanup([...authUserIds, ...users.map((u) => u.authUserId)]);
  });

  async function buyer(label: string, dob = "1990-01-01"): Promise<TestUser> {
    const user = await createTestUser({ label: `reg-${label}`, dob });
    users.push(user);
    return user;
  }

  test("FREE: single transaction confirms inline, issues a pass, and the titular can render their QR", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const a = await buyer("free-self");

    const view = await createRegistrationRequest(
      a.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: a.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    expect(view.status).toBe("CONFIRMED");
    const registration = view.participants[0]?.registration;
    expect(registration?.status).toBe("CONFIRMED");
    const passId = registration?.participant_pass_id;
    expect(passId).toBeTruthy();

    const svg = await renderMyPassQrSvg(a.client, passId!);
    expect(svg).toContain("<svg");

    const third = await buyer("free-third");
    await expectAppError(renderMyPassQrSvg(third.client, passId!), "NOT_FOUND");
    await expectAppError(getMyPass(third.client, passId!), "NOT_FOUND");
  }, 30_000);

  test("EXTERNAL_WHATSAPP: creates a hold/claim, carries whatsapp_url, and staff confirm issues the pass", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 10, whatsappPhone: "+528110009111" });
    const a = await buyer("wa-self");

    const created = await createRegistrationRequest(
      a.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: a.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    expect(created.status).toBe("PENDING_CONFIRMATION");
    expect(created.whatsapp_phone_e164).toBe("+528110009111");
    expect(created.whatsapp_url).toMatch(/^https:\/\/wa\.me\/528110009111\?text=/);
    expect(created.whatsapp_url).not.toContain(a.email);

    const confirmed = await confirmRegistrationRequest(admin.client, created.registration_request_id, null);
    expect(confirmed.status).toBe("CONFIRMED");
    const passId = confirmed.participants[0]?.registration?.participant_pass_id;
    expect(passId).toBeTruthy();
    const svg = await renderMyPassQrSvg(a.client, passId!);
    expect(svg).toContain("<svg");
  }, 30_000);

  test("EXTERNAL_WHATSAPP expiry is effective at expires_at, worker-independent (Master §63/§72)", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 10 });
    const a = await buyer("wa-expiry");

    const created = await createRegistrationRequest(
      a.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: a.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    // Force expiry without running the pg_cron worker: only expires_at governs (worker-independent).
    backdateExpiry(created.registration_request_id);

    const fetched = await getRegistrationRequest(a.client, created.registration_request_id);
    expect(fetched.status).toBe("PENDING_CONFIRMATION"); // raw status: the worker has not materialised it yet
    expect(fetched.effective_status).toBe("EXPIRED"); // effective status already reflects expiry

    await expectAppError(cancelRegistrationRequest(a.client, created.registration_request_id, undefined, null), "REQUEST_EXPIRED");
  }, 30_000);

  test("RevalidateExpiredRegistrationRequestAndConfirm: PRICE_CHANGED blocks until acknowledged, then confirms flagged revalidated_from_expired", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 10, priceAmountMinor: 50000 });
    const a = await buyer("wa-revalidate");

    const created = await createRegistrationRequest(
      a.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: a.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    backdateExpiry(created.registration_request_id);
    sql(`update app.price_offer set amount_minor = 60000 where modality_id = '${edition.modalityId}'`);

    await expectAppError(revalidateAndConfirmRegistrationRequest(admin.client, created.registration_request_id, undefined, null), "PRICE_CHANGED");
    const revalidated = await revalidateAndConfirmRegistrationRequest(admin.client, created.registration_request_id, 60000, null);
    expect(revalidated.status).toBe("CONFIRMED");
    expect(revalidated.revalidated_from_expired).toBe(true);
  }, 30_000);

  test("Guest (adult): the buyer registers a Guest and can render the Guest's pass; a third party cannot", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const a = await buyer("guest-adult-buyer");
    const guest = await createGuest(
      a.client,
      {
        full_name: "Invitado Adulto",
        date_of_birth: "1995-06-01",
        sex_code: "M",
        phone_e164: "+528110004400",
        emergency_contact_name: "Contacto",
        emergency_contact_phone_e164: "+528110004401",
        emergency_contact_relationship: "Amigo",
      },
      null,
    );

    const view = await createRegistrationRequest(
      a.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "GUEST", guest_participant_id: guest.guest_participant_id, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    expect(view.status).toBe("CONFIRMED");
    const passId = view.participants[0]?.registration?.participant_pass_id;
    expect(passId).toBeTruthy();

    const svg = await renderMyPassQrSvg(a.client, passId!);
    expect(svg).toContain("<svg");

    const third = await buyer("guest-adult-third");
    await expectAppError(renderMyPassQrSvg(third.client, passId!), "NOT_FOUND");
  }, 30_000);

  test("Guest (minor): guardian acceptance covers SPORT_WAIVER + MINOR_TERMS and confirms FREE", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const guardian = await buyer("guest-minor-guardian");
    const guest = await createGuest(
      guardian.client,
      {
        full_name: "Invitado Menor",
        date_of_birth: new Date(Date.now() - 16 * 365 * 86_400_000).toISOString().slice(0, 10), // ~16yo
        sex_code: "F",
        phone_e164: "+528110004410",
        emergency_contact_name: "Contacto",
        emergency_contact_phone_e164: "+528110004411",
        emergency_contact_relationship: "Madre",
      },
      null,
    );
    // Ownership alone does not make the buyer a guardian (Master §121/§124): an ACTIVE
    // guardian_assignment is the separate acceptor grant the T33 inclusion check requires.
    sql(`insert into app.guardian_assignment (minor_guest_participant_id, guardian_profile_id, relationship_type, status, activated_at)
         values ('${guest.guest_participant_id}', '${guardian.runnerProfileId}', 'PARENT', 'ACTIVE', now())`);
    const minorTermsId = currentLegalVersionId("MINOR_TERMS");

    const view = await createRegistrationRequest(
      guardian.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "GUEST", guest_participant_id: guest.guest_participant_id, modality_id: edition.modalityId }],
        legal_acceptances: [
          { participant_index: 0, legal_document_version_id: edition.sportWaiverVersionId },
          { participant_index: 0, legal_document_version_id: minorTermsId },
        ],
      },
      null,
    );
    expect(view.status).toBe("CONFIRMED");
    expect(view.participants[0]?.registration?.status).toBe("CONFIRMED");
  }, 30_000);

  test("Friends group registration (EXTERNAL_WHATSAPP): a Friend's own acceptance is deferred and surfaces as a pending action, confirmation blocks until accepted", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 10 });
    const buyerUser = await buyer("friends-buyer");
    const friend = await buyer("friends-friend");
    // Only the buyer themself or a mutual Friend may be a PROFILE participant (Master §124).
    const friendship = await requestFriendship(buyerUser.client, friend.publicProfileId!, null);
    await respondFriendship(friend.client, friendship.friendship_id, "accept");

    const created = await createRegistrationRequest(
      buyerUser.client,
      {
        edition_id: edition.editionId,
        participants: [
          { kind: "PROFILE", public_profile_id: buyerUser.publicProfileId!, modality_id: edition.modalityId },
          { kind: "PROFILE", public_profile_id: friend.publicProfileId!, modality_id: edition.modalityId },
        ],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    expect(created.status).toBe("PENDING_CONFIRMATION");
    expect(created.participants[1]?.legal_acceptance_status).toBe("PENDING");

    const pending = await listMyPendingActions(friend.client, edition.editionId);
    expect(pending.items.some((item) => item.subject.kind === "SELF")).toBe(true);

    await expectAppError(confirmRegistrationRequest(admin.client, created.registration_request_id, null), "LEGAL_ACCEPTANCE_REQUIRED");

    await acceptEditionDocuments(friend.client, edition.editionId, [edition.sportWaiverVersionId], undefined, undefined);
    const confirmed = await confirmRegistrationRequest(admin.client, created.registration_request_id, null);
    expect(confirmed.status).toBe("CONFIRMED");

    // Separate QR ownership (A3): each Friend is their own titular -- the buyer is not "buyer of a
    // GUEST" for another PROFILE participant, so neither can render the other's pass.
    const buyerPassId = confirmed.participants.find((p) => p.public_profile_id === buyerUser.publicProfileId)?.registration?.participant_pass_id;
    const friendPassId = confirmed.participants.find((p) => p.public_profile_id === friend.publicProfileId)?.registration?.participant_pass_id;
    expect(buyerPassId).toBeTruthy();
    expect(friendPassId).toBeTruthy();
    expect(buyerPassId).not.toBe(friendPassId);
    await expect(renderMyPassQrSvg(buyerUser.client, buyerPassId!)).resolves.toContain("<svg");
    await expect(renderMyPassQrSvg(friend.client, friendPassId!)).resolves.toContain("<svg");
    await expectAppError(renderMyPassQrSvg(buyerUser.client, friendPassId!), "NOT_FOUND");
    await expectAppError(renderMyPassQrSvg(friend.client, buyerPassId!), "NOT_FOUND");
  }, 30_000);

  test("staff-cancel is PENDING/EXPIRED only; a CONFIRMED request cannot be staff-cancelled", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 10 });
    const a = await buyer("staff-cancel");
    const created = await createRegistrationRequest(
      a.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: a.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    const confirmed = await confirmRegistrationRequest(admin.client, created.registration_request_id, null);
    expect(confirmed.status).toBe("CONFIRMED");
    await expectAppErrorReason(staffCancelRegistrationRequest(admin.client, created.registration_request_id, "no aplica", null), "CONFLICT", "REQUEST_NOT_CANCELABLE");
  }, 30_000);

  test("replace_pass_credential retires the old version; the pass's QR payload changes and the old material is unreachable", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const a = await buyer("replace-self");
    const view = await createRegistrationRequest(
      a.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: a.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    const passId = view.participants[0]!.registration!.participant_pass_id!;
    const before = await renderMyPassQrSvg(a.client, passId);

    const first = await replacePassCredential(admin.client, passId, "runner reportó pérdida del QR", null);
    expect(first.replaced_version).toBe(1);
    expect(first.next_version).toBe(2);
    const afterFirstReplace = await renderMyPassQrSvg(a.client, passId); // lazily re-issues on render (A1)
    expect(afterFirstReplace).not.toBe(before);

    const second = await replacePassCredential(admin.client, passId, "otra pérdida reportada", null);
    expect(second.replaced_version).toBe(2);
    expect(second.next_version).toBe(3);
    const afterSecondReplace = await renderMyPassQrSvg(a.client, passId);
    expect(afterSecondReplace).not.toBe(afterFirstReplace);

    // Only one ACTIVE credential ever exists for the pass (the old ones are REPLACED, never deleted).
    const activeCount = queryValue(`select count(*)::int from app.participant_pass_credential where participant_pass_id = '${passId}' and status = 'ACTIVE'`);
    expect(activeCount).toBe("1");
    const replacedCount = queryValue(`select count(*)::int from app.participant_pass_credential where participant_pass_id = '${passId}' and status = 'REPLACED'`);
    expect(replacedCount).toBe("2");
  }, 30_000);
});
