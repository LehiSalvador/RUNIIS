import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { activePassPayload } from "@/lib/server/domain/passes/credentials";
import { createEdition, createEvent } from "@/lib/server/domain/events/service";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { cleanup, createTestStaff, createTestUser, queryValue, sql, systemClient, type TestStaff, type TestUser } from "../helpers";
import { callRoute, sessionOrAnon, sessionStore, type RouteHandler, type RouteResponse } from "../closure/harness";
import { currentLegalVersionId, ensureGlobalLegalDocumentsPublished } from "../registration/helpers";
import { buildKitFixture, buildRacedayEdition, openCheckInWindow, registerSelfAndIssueToken } from "./helpers";

// P3-Q race-day API gaps over the real route modules (defineRoute: same-origin guard, auth, zod, Idempotency-Key, envelope, error
// mapping) with real staff sessions against the local Postgres: guardian name + relationship on the scan view and the Guardian desk
// (D1), a REJECTED verification presented as final (D6), kit ids on the admin participant row and on the lookup so the size-change and
// pickup-reversal APIs are reachable (D2), the lookup by public_code (D8) and the PASS_SCAN Edition list (D3).

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon: orAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? orAnon(null) };
});

import { POST as checkInPost } from "@/app/api/v1/check-in/route";
import { GET as guardianListGet } from "@/app/api/v1/admin/guardian-verifications/route";
import { POST as guardianVerifyPost } from "@/app/api/v1/admin/guardian-verifications/[registrationId]/verify/route";
import { POST as guardianRejectPost } from "@/app/api/v1/admin/guardian-verifications/[registrationId]/reject/route";
import { GET as participantsGet } from "@/app/api/v1/admin/editions/[editionId]/participants/route";
import { GET as searchGet } from "@/app/api/v1/admin/editions/[editionId]/participants/search/route";
import { POST as pickupPost } from "@/app/api/v1/admin/kits/pickup/route";
import { POST as reversePost } from "@/app/api/v1/admin/kits/pickup/[kitPickupId]/reverse/route";
import { POST as sizePost } from "@/app/api/v1/admin/kits/allocations/[kitAllocationId]/size/route";
import { GET as scannerEditionsGet } from "@/app/api/v1/scanner/editions/route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function minorDob(): string {
  // 16 years old on the Edition's event date (60 days out; openCheckInWindow later moves it to tomorrow, still a minor).
  return new Date(Date.now() - 16 * 365.25 * 86_400_000).toISOString().slice(0, 10);
}

describe("P3-Q race-day API gaps over the route modules integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let checkin: TestStaff;
  let checkinOtherEdition: TestStaff;
  let checkinDraftOnly: TestStaff;
  let moderator: TestStaff;
  let guardianUser: TestUser;
  let adultUser: TestUser;
  let editionId: string;
  let otherEditionId: string;
  let draftEditionId: string;
  let minorRegistrationId: string;
  let minorToken: string;
  let adultRegistrationId: string;
  let adultPassId: string;
  let kitDefinitionId: string;
  let kitVariantId: string;
  let secondVariantId: string;
  let guardianFullName: string;

  const as = (who: TestStaff | TestUser | null) => who?.client ?? null;
  const call = (handler: unknown, options: Parameters<typeof callRoute>[1]): Promise<RouteResponse> => callRoute(handler as RouteHandler, options);

  beforeAll(async () => {
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
    moderator = await createTestStaff("MODERATOR", "GLOBAL");
    authUserIds.push(moderator.authUserId);

    const edition = await buildRacedayEdition(admin.client);
    editionId = edition.editionId;
    otherEditionId = (await buildRacedayEdition(admin.client)).editionId;

    // A DRAFT Edition (never published): the scanner list must not offer it even to a staff member scoped to it.
    const event = await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: "P3Q Draft", canonical_key: `p3q-${randomUUID()}` }, null);
    draftEditionId = (
      await createEdition(
        admin.client,
        event.event_id,
        {
          slug: `p3q-${randomUUID().slice(0, 8)}`,
          name: "P3Q Draft Edition",
          registration_mode: "FREE",
          city: "Monterrey",
          state_region: "NL",
          schedule: { local_date: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10), local_start_time: "07:00:00" },
        },
        null,
      )
    ).edition_id;

    checkin = await createTestStaff("CHECKIN", "EDITION", editionId);
    checkinOtherEdition = await createTestStaff("CHECKIN", "EDITION", otherEditionId);
    checkinDraftOnly = await createTestStaff("CHECKIN", "EDITION", draftEditionId);
    authUserIds.push(checkin.authUserId, checkinOtherEdition.authUserId, checkinDraftOnly.authUserId);

    // Adult with a kit (the buyer registers themselves).
    adultUser = await createTestUser({ label: "p3q-adult", dob: "1990-01-01" });
    authUserIds.push(adultUser.authUserId);
    const adult = await registerSelfAndIssueToken(adultUser, edition);
    adultRegistrationId = adult.registrationId;
    adultPassId = adult.participantPassId;
    const kit = buildKitFixture(editionId, adultRegistrationId, null);
    kitDefinitionId = kit.kitDefinitionId;
    kitVariantId = kit.kitVariantId;
    secondVariantId = randomUUID();
    sql(`insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, capacity, status)
         values ('${secondVariantId}', '${kitDefinitionId}', 'L', 'Grande', null, 'ACTIVE')`);

    // Minor Guest whose guardian is the buyer (an ACTIVE assignment), so the guardian accepts and the request confirms.
    guardianUser = await createTestUser({ label: "p3q-guardian", dob: "1985-05-05" });
    authUserIds.push(guardianUser.authUserId);
    guardianFullName = queryValue(`select full_name from app.runner_profile where runner_profile_id = '${guardianUser.runnerProfileId}'`)!;
    const guestId = randomUUID();
    sql(`
      insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
        emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
      values ('${guestId}', '${guardianUser.runnerProfileId}', 'Menor P3Q', '${minorDob()}', 'F', '+528110077101', 'Contacto', '+528110077102', 'Madre');
      insert into app.guardian_assignment (minor_guest_participant_id, guardian_profile_id, relationship_type, status, activated_at)
      values ('${guestId}', '${guardianUser.runnerProfileId}', 'PARENT', 'ACTIVE', now());
    `);
    const result = await createRegistrationRequest(
      guardianUser.client,
      {
        edition_id: editionId,
        participants: [{ kind: "GUEST", guest_participant_id: guestId, modality_id: edition.modalityId }],
        legal_acceptances: [
          { participant_index: 0, legal_document_version_id: edition.sportWaiverVersionId },
          { participant_index: 0, legal_document_version_id: currentLegalVersionId("MINOR_TERMS") },
        ],
      },
      null,
    );
    const registration = result.participants[0].registration;
    if (!registration?.participant_pass_id) throw new Error("minor registration did not confirm inline with a pass");
    minorRegistrationId = registration.registration_id;
    minorToken = await activePassPayload(systemClient(), registration.participant_pass_id);

    await openCheckInWindow(admin.client, editionId);
  }, 180_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  const scan = (as_: TestStaff, token: string) =>
    call(checkInPost, { path: "/api/v1/check-in", body: { edition_id: editionId, credential_token: token, station_key: "S1" }, as: as(as_) });
  const guardianList = (as_: TestStaff) => call(guardianListGet, { method: "GET", path: `/api/v1/admin/guardian-verifications?edition_id=${editionId}`, as: as(as_) });
  const adminRow = async (registrationId: string) => {
    const res = await call(participantsGet, { method: "GET", path: `/api/v1/admin/editions/${editionId}/participants`, params: { editionId }, as: as(admin) });
    expect(res.status).toBe(200);
    return (res.body.data as any[]).find((row) => row.registration_id === registrationId);
  };
  const search = (as_: TestStaff, q: string, edition = editionId) =>
    call(searchGet, { method: "GET", path: `/api/v1/admin/editions/${edition}/participants/search?q=${encodeURIComponent(q)}`, params: { editionId: edition }, as: as(as_) });

  test("D1 + P3-AC-09: the scan view names the guardian and the relationship, and nothing else about them", async () => {
    const res = await scan(checkin, minorToken);
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe("GUARDIAN_VERIFICATION_REQUIRED");
    const participant = res.body.data.participant;
    expect(participant.guardian).toEqual({ display_name: guardianFullName, relationship_type: "PARENT" });
    expect(Object.keys(participant.guardian).sort()).toEqual(["display_name", "relationship_type"]);
    // The minor's own fields are unchanged, and no contact data, date of birth or ids of the guardian reach the response.
    expect(participant).toMatchObject({ display_name: "Menor P3Q", guardian_state: "PENDING", is_minor: true, registration_status: "CONFIRMED" });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(guardianUser.email);
    expect(serialized).not.toContain(guardianUser.runnerProfileId!);
    expect(serialized).not.toMatch(/phone_e164|date_of_birth|emergency|\+528110/);
  });

  test("D1: the Guardian desk list carries the guardian, and a PENDING row offers VERIFY and REJECT", async () => {
    const res = await guardianList(checkin);
    expect(res.status).toBe(200);
    const row = (res.body.data as any[]).find((item) => item.participant.registration_id === minorRegistrationId);
    expect(row).toMatchObject({ status: "PENDING", is_final: false, actions: ["VERIFY", "REJECT"] });
    expect(row.participant.guardian).toEqual({ display_name: guardianFullName, relationship_type: "PARENT" });
  });

  test("D6: a REJECTED verification is final in the list (is_final, no actions) and cannot be re-opened", async () => {
    const reject = await call(guardianRejectPost, {
      path: `/api/v1/admin/guardian-verifications/${minorRegistrationId}/reject`,
      params: { registrationId: minorRegistrationId },
      body: { reason: "el adulto no acredita ser el tutor" },
      as: as(checkin),
    });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("REJECTED");

    const row = ((await guardianList(checkin)).body.data as any[]).find((item) => item.participant.registration_id === minorRegistrationId);
    expect(row).toMatchObject({ status: "REJECTED", is_final: true, actions: [] });

    const verify = await call(guardianVerifyPost, {
      path: `/api/v1/admin/guardian-verifications/${minorRegistrationId}/verify`,
      params: { registrationId: minorRegistrationId },
      body: { verification_method: "ID físico" },
      as: as(admin),
    });
    expect(verify.status).toBe(409);
    expect(verify.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "ALREADY_REJECTED" } });
    expect((await scan(checkin, minorToken)).body.data.outcome).toBe("OTHER_REVIEW");
  });

  test("D2: the admin participant row and the lookup carry the kit ids; delivery, reversal and size change are reachable through them", async () => {
    const before = await adminRow(adultRegistrationId);
    expect(before.kit).toMatchObject({ kit_definition_id: kitDefinitionId, kit_variant_id: kitVariantId, status: "ASSIGNED", kit_pickup_id: null });
    expect(before.kit.kit_allocation_id).toMatch(UUID);
    expect(before.pass.participant_pass_id).toBe(adultPassId);

    const picked = await call(pickupPost, {
      path: "/api/v1/admin/kits/pickup",
      body: { edition_id: editionId, kit_definition_id: kitDefinitionId, registration_id: adultRegistrationId, station_key: "K1" },
      as: as(checkin),
    });
    expect(picked.status).toBe(200);
    expect(picked.body.data.outcome).toBe("VALID");
    const pickupId = picked.body.data.kit_pickup_id as string;

    const delivered = await adminRow(adultRegistrationId);
    expect(delivered.kit).toMatchObject({ status: "DELIVERED", kit_pickup_id: pickupId, kit_allocation_id: before.kit.kit_allocation_id });
    const code = queryValue(`select public_code from app.participant_pass where participant_pass_id = '${adultPassId}'`)!;
    const found = await search(checkin, code);
    expect(found.status).toBe(200);
    expect((found.body.data as any[])[0].kit).toMatchObject({ kit_allocation_id: before.kit.kit_allocation_id, kit_pickup_id: pickupId, status: "DELIVERED" });

    const reversed = await call(reversePost, {
      path: `/api/v1/admin/kits/pickup/${pickupId}/reverse`,
      params: { kitPickupId: pickupId },
      body: { reason: "entrega registrada por error" },
      as: as(admin),
    });
    expect(reversed.status).toBe(200);
    expect(reversed.body.data).toMatchObject({ kit_pickup_id: pickupId, status: "REVERSED" });
    expect((await adminRow(adultRegistrationId)).kit).toMatchObject({ status: "ASSIGNED", kit_pickup_id: null });

    const resized = await call(sizePost, {
      path: `/api/v1/admin/kits/allocations/${before.kit.kit_allocation_id}/size`,
      params: { kitAllocationId: before.kit.kit_allocation_id },
      body: { new_kit_variant_id: secondVariantId, reason: "talla incorrecta" },
      as: as(admin),
    });
    expect(resized.status).toBe(200);
    expect(resized.body.data).toMatchObject({ kit_allocation_id: before.kit.kit_allocation_id, kit_variant_id: secondVariantId });
    expect((await adminRow(adultRegistrationId)).kit).toMatchObject({ kit_variant_id: secondVariantId, variant_label: "Grande" });
  });

  test("D8: the lookup matches the exact public_code (any case), not a fragment, and stays scoped to the Edition and the role", async () => {
    const code = queryValue(`select public_code from app.participant_pass where participant_pass_id = '${adultPassId}'`)!;
    for (const query of [code, code.toLowerCase()]) {
      const res = await search(checkin, query);
      expect(res.status).toBe(200);
      expect((res.body.data as any[]).map((item) => item.registration_id)).toEqual([adultRegistrationId]);
      expect((res.body.data as any[])[0].public_code).toBe(code);
    }
    expect((await search(checkin, code.slice(0, -1))).body.data).toEqual([]);
    // The code of this Edition is not found at another Edition's own station, and scope forbids crossing over in either direction.
    expect((await search(checkinOtherEdition, code, otherEditionId)).body.data).toEqual([]);
    expect((await search(checkin, code, otherEditionId)).status).toBe(403);
    expect((await search(checkinOtherEdition, code, editionId)).status).toBe(403);
    expect((await search(checkin, "ab")).status).toBe(400);
  });

  test("D3: the scanner Edition list is gated by PASS_SCAN per scope and never offers a DRAFT", async () => {
    const mine = (res: RouteResponse) => (res.body.data as any[]).filter((item) => [editionId, otherEditionId, draftEditionId].includes(item.edition_id));
    const idsOf = (res: RouteResponse) => mine(res).map((item) => item.edition_id).sort();

    const anonymous = await call(scannerEditionsGet, { method: "GET", path: "/api/v1/scanner/editions", as: null });
    expect(anonymous.status).toBe(401);
    expect((await call(scannerEditionsGet, { method: "GET", path: "/api/v1/scanner/editions", as: as(moderator) })).status).toBe(403);

    const asAdmin = await call(scannerEditionsGet, { method: "GET", path: "/api/v1/scanner/editions", as: as(admin) });
    expect(asAdmin.status).toBe(200);
    expect(idsOf(asAdmin)).toEqual([editionId, otherEditionId].sort());

    const asCheckin = await call(scannerEditionsGet, { method: "GET", path: "/api/v1/scanner/editions", as: as(checkin) });
    expect(asCheckin.status).toBe(200);
    expect(idsOf(asCheckin)).toEqual([editionId]);
    const item = mine(asCheckin)[0];
    expect(Object.keys(item).sort()).toEqual(["date", "edition_id", "event_name", "name", "publication_state", "state", "timezone"]);
    expect(item).toMatchObject({ publication_state: "PUBLISHED", state: "SCHEDULED", timezone: "America/Monterrey" });
    expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const asDraftOnly = await call(scannerEditionsGet, { method: "GET", path: "/api/v1/scanner/editions", as: as(checkinDraftOnly) });
    expect(asDraftOnly.status).toBe(200);
    expect(idsOf(asDraftOnly)).toEqual([]);
  });
});
