import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { confirmRegistrationRequest, createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { cleanup, createTestStaff, createTestUser, queryValue, type TestStaff, type TestUser } from "../helpers";
import { callRoute, type RouteHandler } from "../closure/harness";
import { buildEdition, selfAcceptance, type EditionFixture } from "./helpers";

// P3-D OD-P2-01 measure 3 (P3-AC-13): staff bulk cancellation of PENDING requests over the real route module with real staff sessions:
// staff only with Edition scope, Idempotency-Key required, validation, per-id partial results, capacity released by the source-of-truth
// status, CONFIRMED registrations untouched, idempotent, audited per request plus one batch record, safe under concurrency.

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? sessionOrAnon(null) };
});

import { POST as bulkPost } from "@/app/api/v1/admin/editions/[editionId]/registration-requests/bulk-cancel/route";

const asHandler = (route: unknown) => route as RouteHandler;

describe("staff bulk cancel of PENDING requests (OD-P2-01) integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let operator: TestStaff;
  let checkin: TestStaff;
  let otherOperator: TestStaff;
  let edition: EditionFixture;
  let other: EditionFixture;
  let buyers: TestUser[];
  let requestIds: string[];
  let confirmedRequestId: string;
  let otherEditionRequestId: string;

  const bulk = (editionId: string, body: unknown, as: TestStaff | null, key?: string | null) =>
    callRoute(asHandler(bulkPost), {
      path: `/api/v1/admin/editions/${editionId}/registration-requests/bulk-cancel`,
      params: { editionId },
      body,
      as: as?.client ?? null,
      key,
    });
  const activeHolds = (editionId: string) => Number(queryValue(`select coalesce(sum(quantity), 0) from app.registration_hold h join app.registration_request r using (registration_request_id) where r.edition_id = '${editionId}' and h.status = 'ACTIVE'`));
  const availabilityHolds = (editionId: string) => Number(queryValue(`select (private.edition_availability('${editionId}') -> 'global' ->> 'active_holds')::int`));
  const statusOf = (id: string) => queryValue(`select status from app.registration_request where registration_request_id = '${id}'`);

  const makeRequest = async (user: TestUser, fixture: EditionFixture) => {
    const view = await createRegistrationRequest(
      user.client,
      {
        edition_id: fixture.editionId,
        participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId!, modality_id: fixture.modalityId }],
        legal_acceptances: [selfAcceptance(0, fixture.sportWaiverVersionId)],
      },
      null,
    );
    return view.registration_request_id;
  };

  beforeAll(async () => {
    admin = await createTestStaff("ADMIN", "GLOBAL");
    operator = await createTestStaff("OPERATOR", "GLOBAL");
    checkin = await createTestStaff("CHECKIN", "GLOBAL");
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId);
    edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 30, priceAmountMinor: 20000 });
    other = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 30, priceAmountMinor: 20000 });
    otherOperator = await createTestStaff("OPERATOR", "EDITION", other.editionId);
    authUserIds.push(otherOperator.authUserId);
    buyers = [];
    for (let i = 0; i < 6; i += 1) {
      const user = await createTestUser({ label: `p3d-bulk-${i}` });
      authUserIds.push(user.authUserId);
      buyers.push(user);
    }
    requestIds = [];
    for (let i = 0; i < 5; i += 1) requestIds.push(await makeRequest(buyers[i], edition));
    confirmedRequestId = requestIds[4];
    await confirmRegistrationRequest(admin.client, confirmedRequestId, null);
    otherEditionRequestId = await makeRequest(buyers[0], other);
  }, 240_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  test("staff only, Edition scope, Idempotency-Key required, validated input", async () => {
    const body = { request_ids: [requestIds[0]], reason: "x" };
    expect((await bulk(edition.editionId, body, null)).status).toBe(401);
    expect((await bulk(edition.editionId, body, checkin)).status).toBe(403);
    expect((await bulk(edition.editionId, body, otherOperator)).status).toBe(403);
    expect((await bulk(edition.editionId, body, admin, null)).body.error.details).toMatchObject({ header: "Idempotency-Key", reason: "missing" });
    for (const invalid of [
      { request_ids: [], reason: "x" },
      { request_ids: [requestIds[0], requestIds[0]], reason: "x" },
      { request_ids: Array.from({ length: 101 }, () => randomUUID()), reason: "x" },
      { request_ids: [requestIds[0]], reason: "   " },
      { request_ids: [requestIds[0]], reason: "x", extra: true },
      { request_ids: ["not-a-uuid"], reason: "x" },
    ]) {
      const response = await bulk(edition.editionId, invalid, admin);
      expect(response.status, JSON.stringify(invalid).slice(0, 80)).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect((await bulk(randomUUID(), body, admin)).status).toBe(404);
    expect(statusOf(requestIds[0])).toBe("PENDING_CONFIRMATION");
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  test("a batch cancels the PENDING requests, reports every id, releases capacity and never touches CONFIRMED registrations", async () => {
    const holdsBefore = availabilityHolds(edition.editionId);
    expect(holdsBefore).toBe(4);
    const key = `p3d-bulk-${randomUUID()}`;
    const ghost = randomUUID();
    const body = { request_ids: [requestIds[0], requestIds[1], confirmedRequestId, otherEditionRequestId, ghost], reason: "Sospecha de acaparamiento" };
    const response = await bulk(edition.editionId, body, operator, key);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ edition_id: edition.editionId, requested_count: 5, canceled_count: 2, already_canceled_count: 0, rejected_count: 3, failed_count: 0 });
    const outcome = (id: string) => response.body.data.results.find((row: any) => row.registration_request_id === id);
    expect(outcome(requestIds[0])).toMatchObject({ outcome: "CANCELED", status: "CANCELED_BY_STAFF" });
    expect(outcome(requestIds[1]).outcome).toBe("CANCELED");
    expect(outcome(confirmedRequestId)).toMatchObject({ outcome: "NOT_CANCELABLE", status: "CONFIRMED" });
    expect(outcome(otherEditionRequestId).outcome).toBe("NOT_FOUND");
    expect(outcome(ghost).outcome).toBe("NOT_FOUND");

    expect(statusOf(requestIds[0])).toBe("CANCELED_BY_STAFF");
    expect(statusOf(confirmedRequestId)).toBe("CONFIRMED");
    expect(Number(queryValue(`select count(*) from app.registration where registration_request_id = '${confirmedRequestId}' and status = 'CONFIRMED'`))).toBe(1);
    expect(statusOf(otherEditionRequestId)).toBe("PENDING_CONFIRMATION");
    expect(statusOf(requestIds[2])).toBe("PENDING_CONFIRMATION"); // not listed: untouched
    // Capacity recomputed from the source of truth: two requests' holds are gone, nothing else moved.
    expect(availabilityHolds(edition.editionId)).toBe(holdsBefore - 2);
    expect(activeHolds(edition.editionId)).toBe(holdsBefore - 2);
    expect(cache.revalidateTag).toHaveBeenCalled();

    // Audit: one record per canceled request linked by the batch correlation id, plus one batch record.
    const correlation = response.body.data.correlation_id;
    expect(Number(queryValue(`select count(*) from audit.audit_log where action = 'REGISTRATION_REQUEST_CANCELED' and correlation_id = '${correlation}' and actor_staff_member_id = '${operator.staffMemberId}'`))).toBe(2);
    expect(queryValue(`select (after_snapshot ->> 'canceled_count') || '/' || (after_snapshot ->> 'requested_count') from audit.audit_log where action = 'REGISTRATION_REQUESTS_BULK_CANCELED' and correlation_id = '${correlation}'`)).toBe("2/5");

    // Idempotent per (actor, key): the replay is byte-identical and does nothing; another body under the same key conflicts.
    const replay = await bulk(edition.editionId, body, operator, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(response.body);
    const conflict = await bulk(edition.editionId, { ...body, reason: "otra razón" }, operator, key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(Number(queryValue(`select count(*) from audit.audit_log where action = 'REGISTRATION_REQUEST_CANCELED' and entity_id = '${requestIds[0]}'`))).toBe(1);

    // A retry with a new key finds them already canceled.
    const retry = await bulk(edition.editionId, { request_ids: [requestIds[0], requestIds[1]], reason: "Reintento" }, admin);
    expect(retry.body.data).toMatchObject({ canceled_count: 0, already_canceled_count: 2 });
  });

  test("concurrent batches cancel each request exactly once, and a concurrent new request is neither lost nor deadlocked", async () => {
    const targets = [requestIds[2], requestIds[3]];
    const newcomer = buyers[5];
    const [a, b, created] = await Promise.all([
      bulk(edition.editionId, { request_ids: targets, reason: "Lote A" }, admin),
      bulk(edition.editionId, { request_ids: targets, reason: "Lote B" }, operator),
      createRegistrationRequest(
        newcomer.client,
        {
          edition_id: edition.editionId,
          participants: [{ kind: "PROFILE", public_profile_id: newcomer.publicProfileId!, modality_id: edition.modalityId }],
          legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
        },
        null,
      ),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.canceled_count + b.body.data.canceled_count).toBe(2);
    expect(a.body.data.already_canceled_count + b.body.data.already_canceled_count).toBe(2);
    for (const id of targets) expect(Number(queryValue(`select count(*) from audit.audit_log where action = 'REGISTRATION_REQUEST_CANCELED' and entity_id = '${id}'`))).toBe(1);
    expect(statusOf(created.registration_request_id)).toBe("PENDING_CONFIRMATION");
    // Live holds: the confirmed request's hold is consumed, the newcomer's is the only active one on this Edition.
    expect(activeHolds(edition.editionId)).toBe(1);
    expect(availabilityHolds(edition.editionId)).toBe(1);
  });
});
