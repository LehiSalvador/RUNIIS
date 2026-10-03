import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cleanup, createCookieJar, createTestStaff, httpSignIn, queryValue, sql, type TestStaff } from "../helpers";
import { buildEdition, ensureGlobalLegalDocumentsPublished } from "./helpers";

// P2-G3 over the real HTTP routes: GET /api/v1/me/pending-actions?edition_id= lists, for an ACTIVE guardian, the
// missing event documents of the minors they guard (PROFILE minors and Guests owned by someone else) before any
// request exists, and accepting them unblocks the owner's FREE request that includes the minor Guest.

type Envelope = { data?: any; error?: { code: string; details: Record<string, any> } };
type Jar = ReturnType<typeof createCookieJar>;

async function send(jar: Jar, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Envelope }> {
  const response = await jar.fetch(path, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Envelope) : {} };
}

/** Date of birth that makes someone 16 on the Edition's event date (60 days out). */
function dobMinor(): string {
  return new Date(Date.now() + 60 * 86_400_000 - 16 * 365.25 * 86_400_000 - 120 * 86_400_000).toISOString().slice(0, 10);
}

let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `+52811000${String(5100 + phoneSeq).padStart(4, "0")}`;
}

describe("guardian pending actions before any request (P2-G3) integration", () => {
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

  /** A real signed-in, onboarded adult (HTTP OTP + onboarding that accepts the displayed account documents). */
  async function person(label: string): Promise<{ jar: Jar; authUserId: string; runnerProfileId: string }> {
    const jar = createCookieJar();
    const authUserId = await httpSignIn(jar, `p2g3-${label}-${Date.now()}-${randomUUID().slice(0, 6)}@example.test`);
    authUserIds.push(authUserId);
    const legal = await send(jar, "GET", "/api/v1/me/legal");
    const shown = (legal.body.data.documents as { legal_document_version_id: string }[]).map((d) => d.legal_document_version_id);
    const onboarded = await send(jar, "POST", "/api/v1/me/onboarding", {
      full_name: `Persona ${label}`,
      date_of_birth: "1988-04-04",
      sex_code: "F",
      phone_e164: nextPhone(),
      emergency_contact_name: "Contacto Emergencia",
      emergency_contact_phone_e164: "+528110005999",
      emergency_contact_relationship: "Madre",
      legal_document_version_ids: shown,
    });
    expect(onboarded.status).toBe(200);
    const runnerProfileId = queryValue(`select runner_profile_id::text from app.runner_profile where auth_user_id = '${authUserId}'`)!;
    return { jar, authUserId, runnerProfileId };
  }

  function insertGuest(ownerRunnerProfileId: string, name: string, status: "ACTIVE" | "REVOKED", guardianRunnerProfileId: string): string {
    const id = randomUUID();
    sql(`
      insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
        emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
      values ('${id}', '${ownerRunnerProfileId}', '${name}', '${dobMinor()}', 'F', '${nextPhone()}', 'Contacto', '+528110005999', 'Madre');
      insert into app.guardian_assignment (minor_guest_participant_id, guardian_profile_id, relationship_type, status, activated_at, revoked_at)
      values ('${id}', '${guardianRunnerProfileId}', 'PARENT', '${status}', now(), ${status === "REVOKED" ? "now()" : "null"});
    `);
    return id;
  }

  const items = (body: Envelope) => body.data as { subject: { kind: string; guest_participant_id?: string; public_profile_id?: string }; documents: { legal_document_version_id: string }[] }[];
  const ids = (docs: { legal_document_version_id: string }[]) => docs.map((d) => d.legal_document_version_id).sort();

  test("P2-AC-03.e FREE: the guardian of a minor Guest owned by another account accepts before any request, then the owner's request confirms", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const guardian = await person("guardian");
    const owner = await person("owner");
    const stranger = await person("stranger");
    const guest = insertGuest(owner.runnerProfileId, "Menor Invitada", "ACTIVE", guardian.runnerProfileId);
    const revokedGuest = insertGuest(owner.runnerProfileId, "Menor Revocada", "REVOKED", guardian.runnerProfileId);
    const slug = queryValue(`select slug from app.edition where edition_id = '${edition.editionId}'`)!;
    const query = `/api/v1/me/pending-actions?edition_id=${edition.editionId}`;
    const create = (key: string) =>
      send(
        owner.jar,
        "POST",
        "/api/v1/registration-requests",
        {
          edition_id: edition.editionId,
          participants: [{ kind: "GUEST", guest_participant_id: guest, modality_id: edition.modalityId }],
          legal_acceptances: [],
        },
        { "idempotency-key": key },
      );

    // Owner's view: the minor needs documents only a guardian (not the buyer) may accept.
    const context = (await send(owner.jar, "GET", `/api/v1/events/${slug}/registration-context`)).body.data;
    const candidate = (context.candidates as any[]).find((c) => c.guest_participant_id === guest);
    expect(candidate.acceptance).toMatchObject({ buyer_can_accept: false, acceptor: "OTHER_GUARDIAN" });
    const missing = [...(candidate.acceptance.missing_document_version_ids as string[])].sort();
    expect(missing.length).toBeGreaterThanOrEqual(2);

    // No request exists: the FREE submit is blocked and nobody was told what to do.
    const blocked = await create(`p2g3-blocked-${randomUUID()}`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error!.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(JSON.stringify(blocked.body.error!.details)).toContain("PARTICIPANT_ACCEPTANCE_PENDING");
    expect(queryValue(`select count(*)::int from app.registration_request where edition_id = '${edition.editionId}'`)).toBe("0");

    // Guardian: the minor Guest ward is listed for the Edition, exactly its missing documents, nothing about other minors.
    const guardianList = await send(guardian.jar, "GET", query);
    expect(guardianList.status).toBe(200);
    const wards = items(guardianList.body).filter((i) => i.subject.kind === "MINOR_GUEST");
    expect(wards).toHaveLength(1);
    expect(wards[0].subject).toMatchObject({ kind: "MINOR_GUEST", guest_participant_id: guest, display_name: "Menor Invitada" });
    expect(ids(wards[0].documents)).toEqual(missing);
    expect(JSON.stringify(guardianList.body)).not.toContain(revokedGuest);
    expect(JSON.stringify(guardianList.body)).not.toMatch(/date_of_birth|phone_e164|emergency/);
    // Without the edition filter nothing is listed (existing behaviour: no request exists).
    expect(items(await send(guardian.jar, "GET", "/api/v1/me/pending-actions").then((r) => r.body)).filter((i) => i.subject.kind !== "SELF")).toHaveLength(0);

    // Non-guardians see no ward and cannot accept for it.
    for (const other of [owner, stranger]) {
      const list = await send(other.jar, "GET", query);
      expect(items(list.body).filter((i) => i.subject.kind !== "SELF")).toHaveLength(0);
      const refused = await send(other.jar, "POST", "/api/v1/me/pending-actions/accept-documents", {
        edition_id: edition.editionId,
        legal_document_version_ids: missing,
        minor_guest_participant_id: guest,
      });
      expect(refused.status).toBe(404);
    }
    expect(queryValue(`select count(*)::int from app.legal_acceptance where edition_id = '${edition.editionId}'`)).toBe("0");

    // The guardian accepts (explicit act, nothing automatic): the ward leaves the list and the owner's submit works.
    const accepted = await send(guardian.jar, "POST", "/api/v1/me/pending-actions/accept-documents", {
      edition_id: edition.editionId,
      legal_document_version_ids: ids(wards[0].documents),
      minor_guest_participant_id: guest,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.missing_document_version_ids).toEqual([]);
    expect(items((await send(guardian.jar, "GET", query)).body).filter((i) => i.subject.kind === "MINOR_GUEST")).toHaveLength(0);

    const created = await create(`p2g3-ok-${randomUUID()}`);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: "CONFIRMED", registration_mode: "FREE" });
  }, 180_000);

  test("P2-AC-03.e PROFILE minor ward: listed for the guardian before any request; a revoked assignment stops listing it", async () => {
    const edition = await buildEdition(admin.client, { mode: "FREE" });
    const guardian = await person("guardian-profile");
    const minor = await person("minor-profile");
    // The ward is a READY minor profile (16 on the event date) with an ACTIVE assignment to the guardian.
    sql(`update app.runner_profile set date_of_birth = '${dobMinor()}' where runner_profile_id = '${minor.runnerProfileId}'`);
    sql(`
      insert into app.guardian_assignment (minor_runner_profile_id, guardian_profile_id, relationship_type, status, activated_at)
      values ('${minor.runnerProfileId}', '${guardian.runnerProfileId}', 'PARENT', 'ACTIVE', now())`);
    const minorPublicId = queryValue(`select public_profile_id::text from app.community_profile where runner_profile_id = '${minor.runnerProfileId}'`)!;
    const query = `/api/v1/me/pending-actions?edition_id=${edition.editionId}`;

    const listed = items((await send(guardian.jar, "GET", query)).body).filter((i) => i.subject.kind === "MINOR_PROFILE");
    expect(listed).toHaveLength(1);
    expect(listed[0].subject.public_profile_id).toBe(minorPublicId);
    expect(listed[0].documents.length).toBeGreaterThanOrEqual(2);

    sql(`update app.guardian_assignment set status = 'REVOKED', revoked_at = now() where minor_runner_profile_id = '${minor.runnerProfileId}'`);
    expect(items((await send(guardian.jar, "GET", query)).body).filter((i) => i.subject.kind === "MINOR_PROFILE")).toHaveLength(0);
  }, 180_000);

  test("WhatsApp: a minor already listed through a pending request is not repeated for the guardian", async () => {
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", priceAmountMinor: 25000 });
    const guardian = await person("guardian-wa");
    const owner = await person("owner-wa");
    const guest = insertGuest(owner.runnerProfileId, "Menor Whats", "ACTIVE", guardian.runnerProfileId);
    const query = `/api/v1/me/pending-actions?edition_id=${edition.editionId}`;

    const before = items((await send(guardian.jar, "GET", query)).body).filter((i) => i.subject.kind === "MINOR_GUEST");
    expect(before).toHaveLength(1);

    const created = await send(
      owner.jar,
      "POST",
      "/api/v1/registration-requests",
      {
        edition_id: edition.editionId,
        participants: [{ kind: "GUEST", guest_participant_id: guest, modality_id: edition.modalityId }],
        legal_acceptances: [],
      },
      { "idempotency-key": `p2g3-wa-${randomUUID()}` },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("PENDING_CONFIRMATION");

    const after = items((await send(guardian.jar, "GET", query)).body).filter((i) => i.subject.kind === "MINOR_GUEST");
    expect(after).toHaveLength(1);
    expect(after[0].subject.guest_participant_id).toBe(guest);
    expect(ids(after[0].documents)).toEqual(ids(before[0].documents));
  }, 180_000);
});
