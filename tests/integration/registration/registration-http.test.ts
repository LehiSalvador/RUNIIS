import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createLegalDocumentVersion, publishLegalDocumentVersion, updateEdition } from "@/lib/server/domain/events/service";
import { cleanup, createCookieJar, createTestStaff, httpSignIn, queryValue, sql, type TestStaff } from "../helpers";
import { buildEdition, ensureGlobalLegalDocumentsPublished } from "./helpers";

// P2-B over the real HTTP routes of the shared dev server (real HttpOnly session cookies, real Mailpit OTP):
// registration context, OWN-05 account-level legal routes and the registration-request response the UI consumes
// (P2-AC-02, P2-AC-05, P2-AC-08.a). Drives the wiring that unit tests mock and the domain tests skip.

type Envelope = { data?: Record<string, any>; error?: { code: string; details: Record<string, any> } };

async function send(jar: ReturnType<typeof createCookieJar>, method: string, path: string, body?: unknown): Promise<{ status: number; body: Envelope; headers: Headers }> {
  const response = await jar.fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Envelope) : {}, headers: response.headers };
}

const onboardingFields = {
  full_name: "Persona HTTP Registro",
  date_of_birth: "1990-05-05",
  sex_code: "F",
  phone_e164: "+528110004700",
  emergency_contact_name: "Contacto Emergencia",
  emergency_contact_phone_e164: "+528110004701",
  emergency_contact_relationship: "Madre",
};

describe("registration over HTTP (P2-B) integration", () => {
  let admin: TestStaff;
  const authUserIds: string[] = [];

  beforeAll(async () => {
    sql(`delete from infra.rate_limit_counter where scope in ('auth.otp.ip', 'auth.verify.ip')`);
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
  }, 30_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  test("onboarding legal -> context -> FREE registration -> pass, then a new TERMS version forces re-acceptance", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const slug = queryValue(`select slug from app.edition where edition_id = '${edition.editionId}'`)!;
    const jar = createCookieJar();
    const anon = createCookieJar();

    // Anonymous: the context needs a session; unknown slug is a 404 for a signed-in user.
    expect((await send(anon, "GET", `/api/v1/events/${slug}/registration-context`)).status).toBe(401);
    expect((await send(anon, "GET", "/api/v1/me/legal")).status).toBe(401);
    expect((await send(anon, "POST", "/api/v1/me/legal/accept", { legal_document_version_ids: [] })).status).toBe(401);

    const email = `p2b-http-${Date.now()}@example.test`;
    authUserIds.push(await httpSignIn(jar, email));

    // Before onboarding: legal status is readable (not "ready"), the context is PROFILE_INCOMPLETE.
    const legalBefore = await send(jar, "GET", "/api/v1/me/legal");
    expect(legalBefore.status).toBe(200);
    expect(legalBefore.headers.get("cache-control")).toBe("private, no-store");
    expect(legalBefore.body.data!.needs_acceptance).toBe(true);
    const shown = (legalBefore.body.data!.documents as { legal_document_version_id: string }[]).map((d) => d.legal_document_version_id);
    const preContext = await send(jar, "GET", `/api/v1/events/${slug}/registration-context`);
    expect(preContext.status).toBe(422);
    expect(preContext.body.error!.code).toBe("PROFILE_INCOMPLETE");

    // Onboarding with a stale id is refused with details; with the displayed ids it completes.
    const stale = await send(jar, "POST", "/api/v1/me/onboarding", { ...onboardingFields, legal_document_version_ids: ["69000000-0000-4000-8000-0000000000ee"] });
    expect(stale.status).toBe(422);
    expect(stale.body.error).toMatchObject({ code: "LEGAL_ACCEPTANCE_REQUIRED", details: { reason: "VERSION_NOT_CURRENT", scope: "ACCOUNT" } });
    const onboarded = await send(jar, "POST", "/api/v1/me/onboarding", { ...onboardingFields, legal_document_version_ids: shown });
    expect(onboarded.status).toBe(200);
    expect(onboarded.body.data!.profile_readiness).toBe("READY");
    expect((await send(jar, "GET", "/api/v1/me/legal")).body.data).toMatchObject({ needs_acceptance: false, needs_reacceptance: false });

    // Context: server-authoritative read model.
    const unknown = await send(jar, "GET", "/api/v1/events/no-such-slug-p2b/registration-context");
    expect(unknown.status).toBe(404);
    const contextResponse = await send(jar, "GET", `/api/v1/events/${slug}/registration-context`);
    expect(contextResponse.status).toBe(200);
    expect(contextResponse.headers.get("cache-control")).toBe("private, no-store");
    const context = contextResponse.body.data as Record<string, any>;
    expect(context.edition).toMatchObject({ slug, registration_mode: "FREE" });
    expect(context.registration.can_register).toBe(true);
    expect(context.candidates[0]).toMatchObject({ relation: "SELF", participant_kind: "PROFILE" });
    expect(context.candidates[0].modalities[0].eligible).toBe(true);
    const waiver = (context.documents as { document_type: string; legal_document_version_id: string }[]).find((d) => d.document_type === "SPORT_WAIVER")!;
    expect(context.candidates[0].acceptance.missing_document_version_ids).toContain(waiver.legal_document_version_id);

    // FREE creation through the real route: 201, confirmed inline, registration + pass ids, no hold.
    const self = context.candidates[0];
    const created = await send(jar, "POST", "/api/v1/registration-requests", {
      edition_id: edition.editionId,
      participants: [{ kind: "PROFILE", public_profile_id: self.public_profile_id, modality_id: context.modalities[0].modality_id }],
      legal_acceptances: self.acceptance.missing_document_version_ids.map((legal_document_version_id: string) => ({ participant_index: 0, legal_document_version_id })),
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "CONFIRMED", registration_mode: "FREE", expires_at: null, whatsapp_url: null });
    const passId = created.body.data!.participants[0].registration.participant_pass_id as string;
    expect(passId).toBeTruthy();
    const qr = await jar.fetch(`/api/v1/me/passes/${passId}/render-qr`, { method: "POST" });
    expect(qr.status).toBe(200);

    // The context now lists the registration (with the pass) and marks the participant as already registered.
    const after = (await send(jar, "GET", `/api/v1/events/${slug}/registration-context`)).body.data as Record<string, any>;
    expect(after.existing.registrations).toHaveLength(1);
    expect(after.existing.registrations[0].participant_pass_id).toBe(passId);
    expect(after.candidates[0].modalities[0]).toMatchObject({ eligible: false, code: "DUPLICATE_REGISTRATION" });

    // A newly published TERMS version: the profile reports it and creation is refused until re-accepted.
    const termsId = queryValue(`select legal_document_id::text from app.legal_document where document_key = 'TERMS_OF_SERVICE'`)!;
    const draft = await createLegalDocumentVersion(admin.client, termsId, { content_markdown: "[TEST] TERMS http nueva versión" });
    await publishLegalDocumentVersion(admin.client, draft.legal_document_version_id, null);
    const status = await send(jar, "GET", "/api/v1/me/legal");
    expect(status.body.data).toMatchObject({ needs_acceptance: true, needs_reacceptance: true });
    expect(status.body.data!.missing_document_version_ids).toEqual([draft.legal_document_version_id]);
    const second = await buildEdition(admin.client, { mode: "FREE" });
    const refused = await send(jar, "POST", "/api/v1/registration-requests", {
      edition_id: second.editionId,
      participants: [{ kind: "PROFILE", public_profile_id: self.public_profile_id, modality_id: second.modalityId }],
      legal_acceptances: [{ participant_index: 0, legal_document_version_id: second.sportWaiverVersionId }],
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: "LEGAL_ACCEPTANCE_REQUIRED", details: { scope: "ACCOUNT", reason: "ACCOUNT_DOCUMENTS", needs_reacceptance: true } });

    const supersededId = queryValue(
      `select legal_document_version_id::text from app.legal_document_version where legal_document_id = '${termsId}' and status = 'SUPERSEDED' order by version desc limit 1`,
    )!;
    const staleAccept = await send(jar, "POST", "/api/v1/me/legal/accept", { legal_document_version_ids: [supersededId] });
    expect(staleAccept.status).toBe(422);
    expect(staleAccept.body.error!.details.reason).toBe("VERSION_NOT_CURRENT");
    expect((await send(jar, "POST", "/api/v1/me/legal/accept", { legal_document_version_ids: [draft.legal_document_version_id] })).body.data).toMatchObject({ needs_acceptance: false });
    const ok = await send(jar, "POST", "/api/v1/registration-requests", {
      edition_id: second.editionId,
      participants: [{ kind: "PROFILE", public_profile_id: self.public_profile_id, modality_id: second.modalityId }],
      legal_acceptances: [{ participant_index: 0, legal_document_version_id: second.sportWaiverVersionId }],
    });
    expect(ok.status).toBe(201);
  }, 120_000);

  test("a historical slug answers a real 308 on both /events/:slug and /events/:slug/registration-context", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const oldSlug = queryValue(`select slug from app.edition where edition_id = '${edition.editionId}'`)!;
    const newSlug = `${oldSlug}-v2`;
    await updateEdition(admin.client, edition.editionId, { slug: newSlug });

    const jar = createCookieJar();
    authUserIds.push(await httpSignIn(jar, `p2b-http-redirect-${Date.now()}@example.test`));
    await send(jar, "POST", "/api/v1/me/onboarding", { ...onboardingFields, phone_e164: "+528110004710" });

    const page = await jar.fetch(`/api/v1/events/${oldSlug}`);
    expect(page.status).toBe(308);
    expect(new URL(page.headers.get("location")!).pathname).toBe(`/api/v1/events/${newSlug}`);
    expect(page.headers.get("x-request-id")).toBeTruthy();

    const context = await jar.fetch(`/api/v1/events/${oldSlug}/registration-context`);
    expect(context.status).toBe(308);
    expect(new URL(context.headers.get("location")!).pathname).toBe(`/api/v1/events/${newSlug}/registration-context`);
  }, 60_000);
});
