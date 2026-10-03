import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AppError } from "@/lib/server/http/errors";
import { acceptAccountLegalDocuments, completeOnboarding, ensureRunnerProfile, getMyLegalStatus } from "@/lib/server/domain/auth/service";
import { createLegalDocumentVersion, publishLegalDocumentVersion } from "@/lib/server/domain/events/service";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { cleanup, createTestStaff, createTestUser, queryValue, type TestStaff, type TestUser } from "../helpers";
import { buildEdition, ensureGlobalLegalDocumentsPublished, selfAcceptance } from "./helpers";

// OWN-05 (owner decision 2026-10-03): TERMS_OF_SERVICE + PRIVACY_NOTICE are accepted in onboarding and
// re-accepted when a newer version is published; creating a registration request requires the CURRENT
// account-level acceptance. Event documents stay per participant (registration.test.ts).
// Drives the domain/service layer against the real local Postgres + RLS (P2-AC-02.a, P2-AC-02.b).

async function appError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected the promise to reject with an AppError");
}

const onboardingFields = {
  full_name: "Persona Legal Integración",
  date_of_birth: "1990-05-05",
  sex_code: "F" as const,
  phone_e164: "+528110004500",
  emergency_contact_name: "Contacto Emergencia",
  emergency_contact_phone_e164: "+528110004501",
  emergency_contact_relationship: "Madre",
};

/** Current account-level documents (one per ACTIVE TERMS/PRIVACY document that has a PUBLISHED version). Other suites
 * may leave extra ACTIVE documents in a shared local DB, so counts come from the database, not from a literal. */
function currentDocumentCount(): number {
  return Number(queryValue("select count(*)::int from private.account_legal_current_versions()"));
}

function documentId(documentKey: string): string {
  const id = queryValue(`select legal_document_id::text from app.legal_document where document_key = '${documentKey}'`);
  if (!id) throw new Error(`no legal_document ${documentKey}`);
  return id;
}

describe("account-level legal acceptance (OWN-05) integration", () => {
  let admin: TestStaff;
  const authUserIds: string[] = [];

  beforeAll(async () => {
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
  }, 30_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  async function newcomer(label: string): Promise<TestUser> {
    const user = await createTestUser({ label: `legal-${label}`, ready: false });
    authUserIds.push(user.authUserId);
    await ensureRunnerProfile(user.client);
    return user;
  }

  test("onboarding with the displayed current versions records the acceptance (type/version/actor/accepted_at/context)", async () => {
    const user = await newcomer("onboard-ok");
    const before = await getMyLegalStatus(user.client);
    expect(before.documents).toHaveLength(currentDocumentCount());
    expect(new Set(before.documents.map((d) => d.document_type))).toEqual(new Set(["PRIVACY_NOTICE", "TERMS_OF_SERVICE"]));
    expect(before.needs_acceptance).toBe(true);
    expect(before.needs_reacceptance).toBe(false);
    expect(before.documents.every((d) => d.status === "NEVER_ACCEPTED")).toBe(true);

    const profile = await completeOnboarding(user.client, { ...onboardingFields, legal_document_version_ids: before.documents.map((d) => d.legal_document_version_id) }, null);
    expect(profile.profile_readiness).toBe("READY");

    const after = await getMyLegalStatus(user.client);
    expect(after.needs_acceptance).toBe(false);
    expect(after.documents.every((d) => d.status === "ACCEPTED" && d.accepted_at !== null)).toBe(true);

    const rows = queryValue(`
      select count(*)::int || ':' || bool_and(la.acceptance_context ->> 'via' = 'onboarding' and (la.acceptance_context ->> 'client_confirmed')::boolean)::text
      from app.legal_acceptance la where la.runner_profile_id = '${profile.runner_profile_id}'
        and la.edition_id is null and la.registration_request_id is null
    `);
    expect(rows).toBe(`${currentDocumentCount()}:true`);
  }, 30_000);

  test("onboarding refuses a stale or incomplete version list with a stable code and records nothing", async () => {
    const user = await newcomer("onboard-stale");
    const status = await getMyLegalStatus(user.client);
    const [first] = status.documents;

    const stale = await appError(
      completeOnboarding(user.client, { ...onboardingFields, legal_document_version_ids: ["69000000-0000-4000-8000-0000000000ff"] }, null),
    );
    expect(stale.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(stale.details.reason).toBe("VERSION_NOT_CURRENT");
    expect(stale.details.scope).toBe("ACCOUNT");
    expect((stale.details.required_legal_document_version_ids as string[]).length).toBe(currentDocumentCount());

    const partial = await appError(completeOnboarding(user.client, { ...onboardingFields, legal_document_version_ids: [first!.legal_document_version_id] }, null));
    expect(partial.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(partial.details.reason).toBe("MISSING_DOCUMENTS");

    expect((await getMyLegalStatus(user.client)).documents.every((d) => d.status === "NEVER_ACCEPTED")).toBe(true);
  }, 30_000);

  test("legacy onboarding (no version ids) still records the current versions", async () => {
    const user = await newcomer("onboard-legacy");
    await completeOnboarding(user.client, onboardingFields, null);
    expect((await getMyLegalStatus(user.client)).needs_acceptance).toBe(false);
  }, 30_000);

  test("P2-AC-02.b: a buyer without current account-level acceptance cannot create a request (stable code, scope ACCOUNT)", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const user = await createTestUser({ label: "legal-gate", accountLegalAccepted: false });
    authUserIds.push(user.authUserId);

    const error = await appError(
      createRegistrationRequest(
        user.client,
        {
          edition_id: edition.editionId,
          participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId!, modality_id: edition.modalityId }],
          legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
        },
        null,
      ),
    );
    expect(error.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(error.status).toBe(422);
    expect(error.details.scope).toBe("ACCOUNT");
    expect(error.details.reason).toBe("ACCOUNT_DOCUMENTS");
    expect(error.details.needs_reacceptance).toBe(false);
    expect((error.details.missing_document_version_ids as string[]).length).toBe(currentDocumentCount());

    // Nothing was created: no request, no hold, no registration.
    expect(queryValue(`select count(*)::int from app.registration_request where buyer_profile_id = '${user.runnerProfileId}'`)).toBe("0");

    // Accepting through the dedicated endpoint unblocks the very same request.
    const status = await getMyLegalStatus(user.client);
    const accepted = await acceptAccountLegalDocuments(user.client, status.missing_document_version_ids);
    expect(accepted.needs_acceptance).toBe(false);
    const view = await createRegistrationRequest(
      user.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    expect(view.status).toBe("CONFIRMED");
  }, 60_000);

  test("P2-AC-02.a: a newly published TERMS version makes the profile report needs_reacceptance until the new version is accepted", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const user = await createTestUser({ label: "legal-reaccept" });
    authUserIds.push(user.authUserId);
    expect((await getMyLegalStatus(user.client)).needs_acceptance).toBe(false);

    const draft = await createLegalDocumentVersion(admin.client, documentId("TERMS_OF_SERVICE"), { content_markdown: "[TEST] TERMS_OF_SERVICE nueva versión" });
    await publishLegalDocumentVersion(admin.client, draft.legal_document_version_id, null);

    const status = await getMyLegalStatus(user.client);
    expect(status.needs_reacceptance).toBe(true);
    expect(status.needs_acceptance).toBe(true);
    const terms = status.documents.find((d) => d.document_key === "TERMS_OF_SERVICE")!;
    expect(terms.status).toBe("NEW_VERSION");
    expect(terms.legal_document_version_id).toBe(draft.legal_document_version_id);
    expect(terms.accepted_version).toBeLessThan(terms.version);
    expect(status.documents.find((d) => d.document_key === "PRIVACY_NOTICE")!.status).toBe("ACCEPTED");
    expect(status.missing_document_version_ids).toEqual([draft.legal_document_version_id]);

    const blocked = await appError(
      createRegistrationRequest(
        user.client,
        {
          edition_id: edition.editionId,
          participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId!, modality_id: edition.modalityId }],
          legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
        },
        null,
      ),
    );
    expect(blocked.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(blocked.details.needs_reacceptance).toBe(true);

    // The previous version can no longer be accepted; only the current one.
    const supersededId = queryValue(
      `select legal_document_version_id::text from app.legal_document_version where legal_document_id = '${documentId("TERMS_OF_SERVICE")}' and status = 'SUPERSEDED' order by version desc limit 1`,
    )!;
    const stale = await appError(acceptAccountLegalDocuments(user.client, [supersededId]));
    expect(stale.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(stale.details.reason).toBe("VERSION_NOT_CURRENT");

    const after = await acceptAccountLegalDocuments(user.client, [draft.legal_document_version_id]);
    expect(after.needs_reacceptance).toBe(false);
    expect(after.needs_acceptance).toBe(false);
    // Naturally idempotent: accepting again changes nothing and inserts no duplicate row.
    await acceptAccountLegalDocuments(user.client, [draft.legal_document_version_id]);
    expect(
      queryValue(`select count(*)::int from app.legal_acceptance where runner_profile_id = '${user.runnerProfileId}' and legal_document_version_id = '${draft.legal_document_version_id}'`),
    ).toBe("1");

    const view = await createRegistrationRequest(
      user.client,
      {
        edition_id: edition.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId!, modality_id: edition.modalityId }],
        legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
      },
      null,
    );
    expect(view.status).toBe("CONFIRMED");
  }, 60_000);

  test("another account's acceptance never satisfies mine (acceptance is per actor)", async () => {
    const a = await createTestUser({ label: "legal-actor-a", accountLegalAccepted: false });
    const b = await createTestUser({ label: "legal-actor-b" });
    authUserIds.push(a.authUserId, b.authUserId);
    expect((await getMyLegalStatus(b.client)).needs_acceptance).toBe(false);
    expect((await getMyLegalStatus(a.client)).needs_acceptance).toBe(true);
  }, 30_000);
});
