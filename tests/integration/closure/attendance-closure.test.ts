import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, createTestStaff, queryValue, type TestStaff } from "../helpers";
import { callRoute, sessionStore, type RouteHandler } from "./harness";
import { activeCreditCount, attendanceStatus, buildClosureEdition, finishEdition, type ClosureEdition } from "./fixtures";

// P3-C staff APIs for the T41 closure domain (P3-AC-02, P3-AC-03, P3-AC-15): attendance workspace, resolve attendance,
// resolve sporting eligibility, finalize (bulk MarkRemainingNoShow), reopen finalization, close edition, reopen edition.
// Real route modules + real signed-in staff + real local Postgres; the request path is defineRoute end to end.

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon } = await import("./harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? sessionOrAnon(null) };
});

import { GET as workspaceGet } from "@/app/api/v1/admin/editions/[editionId]/attendance/route";
import { POST as finalizePost } from "@/app/api/v1/admin/editions/[editionId]/attendance/finalize/route";
import { POST as reopenFinalizationPost } from "@/app/api/v1/admin/editions/[editionId]/attendance/reopen/route";
import { POST as closePost } from "@/app/api/v1/admin/editions/[editionId]/close/route";
import { POST as reopenEditionPost } from "@/app/api/v1/admin/editions/[editionId]/reopen/route";
import { POST as resolveAttendancePost } from "@/app/api/v1/admin/registrations/[id]/attendance/resolve/route";
import { POST as resolveEligibilityPost } from "@/app/api/v1/admin/registrations/[id]/sporting-eligibility/resolve/route";
import { POST as cancelPost } from "@/app/api/v1/admin/registrations/[id]/cancel/route";
import { POST as changeModalityPost } from "@/app/api/v1/admin/registrations/[id]/change-modality/route";

void sessionStore;
const asHandler = (route: unknown) => route as RouteHandler;
const key = (label: string) => `${label}-${randomUUID()}`;
const evidence = { method: "MANUAL_DESK", note: "Visto en la mesa de llegada" };

describe("closure APIs (P3-C) integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let operator: TestStaff;
  let checkin: TestStaff;
  let otherAdmin: TestStaff;
  let otherOperator: TestStaff;
  let secondAdmin: TestStaff;
  let edition: ClosureEdition;
  let other: ClosureEdition;
  let ids: { A: string; B: string; C: string; D: string };

  const workspacePath = (editionId: string) => `/api/v1/admin/editions/${editionId}/attendance`;

  beforeAll(async () => {
    admin = await createTestStaff("ADMIN", "GLOBAL");
    operator = await createTestStaff("OPERATOR", "GLOBAL");
    checkin = await createTestStaff("CHECKIN", "GLOBAL");
    secondAdmin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId, secondAdmin.authUserId);
    edition = await buildClosureEdition(admin.client, authUserIds, { runners: 4, label: "p3c-main" });
    other = await buildClosureEdition(admin.client, authUserIds, { runners: 2, label: "p3c-other" });
    otherAdmin = await createTestStaff("ADMIN", "EDITION", other.editionId);
    otherOperator = await createTestStaff("OPERATOR", "EDITION", other.editionId);
    authUserIds.push(otherAdmin.authUserId, otherOperator.authUserId);
    const [A, B, C, D] = edition.runners.map((runner) => runner.registrationId);
    ids = { A, B, C, D };
    finishEdition(edition.editionId);
    finishEdition(other.editionId);
  }, 240_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  // ---- attendance workspace ----

  test("workspace: staff scope, never cached, never prefetched, explicit cap/truncation marker", async () => {
    const path = workspacePath(edition.editionId);
    const params = { editionId: edition.editionId };
    expect((await callRoute(asHandler(workspaceGet), { method: "GET", path, params, as: null })).status).toBe(401);
    const forCheckin = await callRoute(asHandler(workspaceGet), { method: "GET", path, params, as: checkin.client });
    expect(forCheckin.status).toBe(403);
    expect(forCheckin.body.error.code).toBe("FORBIDDEN");
    // An Edition-scoped operator of ANOTHER Edition (SEC-020).
    expect((await callRoute(asHandler(workspaceGet), { method: "GET", path, params, as: otherOperator.client })).status).toBe(403);
    // Speculative requests are refused: the workspace writes (universe sync).
    for (const headers of [{ "sec-purpose": "prefetch" } as Record<string, string>, { purpose: "prefetch" }, { "next-router-prefetch": "1" }, { "sec-fetch-site": "cross-site" }]) {
      const refused = await callRoute(asHandler(workspaceGet), { method: "GET", path, params, as: operator.client, headers });
      expect(refused.status, JSON.stringify(headers)).toBe(403);
    }
    expect((await callRoute(asHandler(workspaceGet), { method: "GET", path: workspacePath("not-a-uuid"), params: { editionId: "not-a-uuid" }, as: operator.client })).status).toBe(400);

    const ok = await callRoute(asHandler(workspaceGet), { method: "GET", path, params, as: operator.client });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("x-request-id")).toBeTruthy();
    const data = ok.body.data;
    expect(data).toMatchObject({ edition_id: edition.editionId, universe_count: 4, participants_truncated: false, participants_cap: 2000, current_finalization: null, current_closure: null });
    expect(data.participants).toHaveLength(4);
    expect(data.attendance_counts).toEqual({ PENDING: 4 });
    expect(data.finalize_readiness.ready).toBe(false);
    expect(data.close_readiness.ready).toBe(false);
    expect(data.participants[0]).toMatchObject({ participant_kind: "PROFILE", attendance: { status: "PENDING", source: "INITIAL" }, has_active_credit: false });
    expect(data.participants[0].display_name).toBeTruthy();
  });

  // ---- resolve attendance ----

  test("resolve attendance: validation, forbidden roles, evidence, replay, idempotency conflict, correction", async () => {
    const path = (id: string) => `/api/v1/admin/registrations/${id}/attendance/resolve`;
    const call = (id: string, body: unknown, as: TestStaff | null, options: { key?: string | null } = {}) =>
      callRoute(asHandler(resolveAttendancePost), { path: path(id), params: { id }, body, as: as?.client ?? null, key: options.key });

    // Idempotency-Key is mandatory on every mutation; the body is strict.
    const noKey = await call(ids.A, { status: "NO_SHOW" }, operator, { key: null });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { header: "Idempotency-Key", reason: "missing" } });
    expect((await call(ids.A, { status: "NO_SHOW", extra: true }, operator)).status).toBe(400);
    const noEvidence = await call(ids.A, { status: "PRESENT", reason: "Llegó" }, operator);
    expect(noEvidence.status).toBe(400);
    expect(noEvidence.body.error.details.issues).toEqual(expect.arrayContaining([expect.objectContaining({ location: "body", path: "evidence_metadata" })]));
    const noReason = await call(ids.C, { status: "EXCLUDED" }, operator);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details.issues[0]).toMatchObject({ path: "reason" });

    // Roles and scope.
    expect((await call(ids.A, { status: "NO_SHOW" }, null)).status).toBe(401);
    expect((await call(ids.A, { status: "NO_SHOW" }, checkin)).status).toBe(403);
    const wrongScope = await call(ids.A, { status: "NO_SHOW" }, otherOperator);
    expect(wrongScope.status).toBe(403);
    expect(wrongScope.body.error.code).toBe("FORBIDDEN");
    expect(attendanceStatus(ids.A)).toBe("PENDING"); // the refused commands changed nothing

    // Unknown registration.
    const unknown = await call(randomUUID(), { status: "NO_SHOW" }, operator);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("NOT_FOUND");

    // PRESENT with reason + evidence (A), replay, then a different body under the same key.
    const presentKey = key("present-a");
    const present = await call(ids.A, { status: "PRESENT", reason: "Llegó a la mesa", evidence_metadata: evidence }, operator, { key: presentKey });
    expect(present.status).toBe(200);
    expect(present.body.data).toMatchObject({ registration_id: ids.A, status: "PRESENT", source: "MANUAL", reason: "Llegó a la mesa", evidence_metadata: evidence });
    const replay = await call(ids.A, { status: "PRESENT", reason: "Llegó a la mesa", evidence_metadata: evidence }, operator, { key: presentKey });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(present.body.data);
    expect(Number(queryValue(`select count(*) from app.attendance_resolution where registration_id = '${ids.A}'`))).toBe(2); // INITIAL + MANUAL, the replay added none
    const conflict = await call(ids.A, { status: "NO_SHOW" }, operator, { key: presentKey });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");

    // NO_SHOW needs nothing else (B). EXCLUDED then corrected to PRESENT (C): the settled row is superseded, never overwritten.
    expect((await call(ids.B, { status: "NO_SHOW" }, operator)).body.data).toMatchObject({ status: "NO_SHOW", source: "MANUAL" });
    expect((await call(ids.C, { status: "EXCLUDED", reason: "Documento inválido" }, operator)).body.data).toMatchObject({ status: "EXCLUDED", source: "MANUAL" });
    const correction = await call(ids.C, { status: "PRESENT", reason: "Se aclaró el documento", evidence_metadata: evidence }, operator);
    expect(correction.status).toBe(200);
    expect(correction.body.data).toMatchObject({ status: "PRESENT", source: "CORRECTION", revision: 3 });
    expect(attendanceStatus(ids.C)).toBe("PRESENT");
    expect(Number(queryValue(`select count(*) from audit.audit_log where action = 'ATTENDANCE_RESOLVED' and entity_id = '${ids.C}'`))).toBe(2);
    expect(attendanceStatus(ids.D)).toBe("PENDING"); // synced, still unresolved
  });

  // ---- resolve sporting eligibility ----

  test("resolve sporting eligibility: validation, forbidden, PENDING_REVIEW blocks, DISQUALIFIED denies kilometres", async () => {
    const path = (id: string) => `/api/v1/admin/registrations/${id}/sporting-eligibility/resolve`;
    const call = (id: string, body: unknown, as: TestStaff | null) =>
      callRoute(asHandler(resolveEligibilityPost), { path: path(id), params: { id }, body, as: as?.client ?? null });

    // PENDING_REVIEW can never carry a releasing disposition; DISQUALIFIED/EXCLUDED need a reason.
    const reviewAllow = await call(ids.D, { status: "PENDING_REVIEW", distance_credit_disposition: "ALLOW" }, operator);
    expect(reviewAllow.status).toBe(400);
    expect(reviewAllow.body.error.details.issues[0]).toMatchObject({ path: "distance_credit_disposition", message: "pending_review_requires_pending" });
    expect((await call(ids.C, { status: "DISQUALIFIED", distance_credit_disposition: "DENY" }, operator)).status).toBe(400);
    expect((await call(ids.C, { status: "ELIGIBLE", distance_credit_disposition: "MAYBE" }, operator)).status).toBe(400);

    expect((await call(ids.C, { status: "DISQUALIFIED", distance_credit_disposition: "DENY", reason: "x" }, null)).status).toBe(401);
    expect((await call(ids.C, { status: "DISQUALIFIED", distance_credit_disposition: "DENY", reason: "x" }, checkin)).status).toBe(403);
    expect((await call(ids.C, { status: "DISQUALIFIED", distance_credit_disposition: "DENY", reason: "x" }, otherOperator)).status).toBe(403);

    const review = await call(ids.D, { status: "PENDING_REVIEW", distance_credit_disposition: "PENDING", reason_code: "DOC_CHECK" }, operator);
    expect(review.status).toBe(200);
    expect(review.body.data).toMatchObject({ registration_id: ids.D, status: "PENDING_REVIEW", distance_credit_disposition: "PENDING", reason_code: "DOC_CHECK" });
    const dq = await call(ids.C, { status: "DISQUALIFIED", distance_credit_disposition: "DENY", reason: "Corte de ruta" }, operator);
    expect(dq.status).toBe(200);
    expect(dq.body.data).toMatchObject({ status: "DISQUALIFIED", distance_credit_disposition: "DENY", reason: "Corte de ruta" });
  });

  // ---- finalize ----

  test("finalize: blocked by pending resolutions (bulk rolls back), bulk MarkRemainingNoShow, replay, already finalized", async () => {
    const path = `/api/v1/admin/editions/${edition.editionId}/attendance/finalize`;
    const params = { editionId: edition.editionId };
    const call = (body: unknown, as: TestStaff | null, options: { key?: string | null; editionId?: string } = {}) =>
      callRoute(asHandler(finalizePost), {
        path: options.editionId ? `/api/v1/admin/editions/${options.editionId}/attendance/finalize` : path,
        params: options.editionId ? { editionId: options.editionId } : params,
        body,
        as: as?.client ?? null,
        key: options.key,
      });

    expect((await call({}, null)).status).toBe(401);
    expect((await call({}, checkin)).status).toBe(403);
    expect((await call({}, otherAdmin)).status).toBe(403);
    expect((await call({}, operator, { key: null })).body.error.details).toMatchObject({ header: "Idempotency-Key", reason: "missing" });
    const bulkNoReason = await call({ mark_remaining_no_show: true }, operator);
    expect(bulkNoReason.status).toBe(400);
    expect(bulkNoReason.body.error.details.issues[0]).toMatchObject({ path: "reason" });

    // D is PENDING attendance and PENDING_REVIEW eligibility -> blocked, with the readiness the UI renders.
    const blocked = await call({}, operator);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(blocked.body.error.details.reason).toBe("not_ready");
    const checks = blocked.body.error.details.readiness.checks as { code: string; ok: boolean }[];
    expect(checks.find((c) => c.code === "NO_PENDING_ATTENDANCE")).toMatchObject({ ok: false });
    expect(checks.find((c) => c.code === "NO_PENDING_ELIGIBILITY")).toMatchObject({ ok: false });
    expect(checks.find((c) => c.code === "EXECUTION_FINISHED")).toMatchObject({ ok: true });
    expect(JSON.stringify(blocked.body)).not.toMatch(/select |insert |pg_|stack/i); // no SQL or internals

    // Bulk with the explicit scope marks D NO_SHOW but the refused finalization rolls it back (eligibility still pending).
    const bulkBlocked = await call({ mark_remaining_no_show: true, reason: "No se presentaron" }, operator);
    expect(bulkBlocked.status).toBe(422);
    expect(attendanceStatus(ids.D)).toBe("PENDING");

    // Resolve D's review, then finalize with the bulk step.
    const eligible = await callRoute(asHandler(resolveEligibilityPost), {
      path: `/api/v1/admin/registrations/${ids.D}/sporting-eligibility/resolve`,
      params: { id: ids.D },
      body: { status: "ELIGIBLE", distance_credit_disposition: "ALLOW" },
      as: operator.client,
    });
    expect(eligible.status).toBe(200);
    const finalizeKey = key("finalize");
    const finalized = await call({ mark_remaining_no_show: true, reason: "No se presentaron" }, operator, { key: finalizeKey });
    expect(finalized.status).toBe(200);
    expect(finalized.body.data).toMatchObject({ edition_id: edition.editionId, revision: 1, status: "FINALIZED", expected_count: 4, present_count: 2, no_show_count: 2, excluded_count: 0 });
    expect(attendanceStatus(ids.D)).toBe("NO_SHOW");
    expect(Number(queryValue(`select (after_snapshot ->> 'marked_count')::int from audit.audit_log where action = 'ATTENDANCE_BULK_NO_SHOW_MARKED' and entity_id = '${edition.editionId}'`))).toBe(1);

    // Same key replays (no second finalization); another key sees the finalization that already exists.
    const replay = await call({ mark_remaining_no_show: true, reason: "No se presentaron" }, operator, { key: finalizeKey });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(finalized.body.data);
    const again = await call({}, operator);
    expect(again.status).toBe(422);
    expect(again.body.error.details.reason).toBe("already_finalized");
    expect(Number(queryValue(`select count(*) from app.attendance_finalization where edition_id = '${edition.editionId}'`))).toBe(1);
  });

  // ---- after finalization: blocked commands, reopen finalization ----

  test("after finalization, attendance resolution, cancel and change modality are blocked (reopen first)", async () => {
    const blockedAttendance = await callRoute(asHandler(resolveAttendancePost), {
      path: `/api/v1/admin/registrations/${ids.A}/attendance/resolve`,
      params: { id: ids.A },
      body: { status: "NO_SHOW" },
      as: operator.client,
    });
    expect(blockedAttendance.status).toBe(422);
    expect(blockedAttendance.body.error).toMatchObject({ code: "CLOSURE_BLOCKED", details: { reason: "attendance_finalized" } });

    // OWN-04: after finalization cancellation only goes through reopen/correction.
    const blockedCancel = await callRoute(asHandler(cancelPost), {
      path: `/api/v1/admin/registrations/${ids.D}/cancel`,
      params: { id: ids.D },
      body: { reason: "Después de finalizar", reason_category: "ADMINISTRATIVE" },
      as: operator.client,
    });
    expect(blockedCancel.status).toBe(422);
    expect(blockedCancel.body.error).toMatchObject({ code: "CLOSURE_BLOCKED", details: { reason: "attendance_finalized" } });
    const blockedChange = await callRoute(asHandler(changeModalityPost), {
      path: `/api/v1/admin/registrations/${ids.D}/change-modality`,
      params: { id: ids.D },
      body: { new_modality_id: edition.secondModalityId, reason: "Después de finalizar" },
      as: operator.client,
    });
    expect(blockedChange.status).toBe(422);
    expect(blockedChange.body.error.code).toBe("CLOSURE_BLOCKED");
    expect(queryValue(`select status from app.registration where registration_id = '${ids.D}'`)).toBe("CONFIRMED");
  });

  test("reopen finalization: reason mandatory, staff only, audited; attendance is editable and finalizable again", async () => {
    const path = `/api/v1/admin/editions/${edition.editionId}/attendance/reopen`;
    const params = { editionId: edition.editionId };
    const call = (body: unknown, as: TestStaff | null) => callRoute(asHandler(reopenFinalizationPost), { path, params, body, as: as?.client ?? null });

    expect((await call({ reason: "x" }, checkin)).status).toBe(403);
    expect((await call({ reason: "x" }, otherOperator)).status).toBe(403);
    expect((await call({}, operator)).status).toBe(400);
    expect((await call({ reason: "   " }, operator)).status).toBe(400);

    const reopened = await call({ reason: "Corrección de asistencia" }, operator);
    expect(reopened.status).toBe(200);
    expect(reopened.body.data).toEqual({ edition_id: edition.editionId, reopened: true });
    expect(Number(queryValue(`select count(*) from audit.audit_log where action = 'ATTENDANCE_FINALIZATION_REOPENED' and entity_id = '${edition.editionId}'`))).toBe(1);
    const twice = await call({ reason: "otra vez" }, operator);
    expect(twice.status).toBe(422);
    expect(twice.body.error.details.reason).toBe("no_current_finalization");

    const workspace = await callRoute(asHandler(workspaceGet), { method: "GET", path: workspacePath(edition.editionId), params, as: operator.client });
    expect(workspace.body.data.current_finalization).toBeNull();
    expect(workspace.body.data.attendance_counts).toEqual({ PRESENT: 2, NO_SHOW: 2 });
    expect(workspace.body.data.finalize_readiness.ready).toBe(true);

    const refinalized = await callRoute(asHandler(finalizePost), { path: `${path.replace("/reopen", "/finalize")}`, params, body: {}, as: operator.client });
    expect(refinalized.status).toBe(200);
    expect(refinalized.body.data).toMatchObject({ revision: 2, present_count: 2, no_show_count: 2 });
  });

  // ---- close edition / reopen edition ----

  test("close: ADMIN only, scoped, exactly-once credits, replay, repeated close is a CONFLICT", async () => {
    const path = `/api/v1/admin/editions/${edition.editionId}/close`;
    const params = { editionId: edition.editionId };
    const call = (as: TestStaff | null, options: { key?: string | null } = {}) =>
      callRoute(asHandler(closePost), { path, params, body: {}, as: as?.client ?? null, key: options.key });

    expect((await call(null)).status).toBe(401);
    expect((await call(operator)).status).toBe(403); // EDITION_CLOSURE_MANAGE is ADMIN only
    expect((await call(checkin)).status).toBe(403);
    expect((await call(otherAdmin)).status).toBe(403); // ADMIN of another Edition
    expect((await call(admin, { key: null })).body.error.details).toMatchObject({ header: "Idempotency-Key", reason: "missing" });
    expect((await callRoute(asHandler(closePost), { path, params, body: { force: true }, as: admin.client })).status).toBe(400);
    expect(activeCreditCount(edition.editionId)).toBe(0);

    const closeKey = key("close");
    const closed = await call(admin, { key: closeKey });
    expect(closed.status).toBe(200);
    // A (ALLOW) earns a credit; C is DISQUALIFIED/DENY, B and D are NO_SHOW.
    expect(closed.body.data).toMatchObject({ edition_id: edition.editionId, status: "CLOSED", revision: 1, credits_created: 1 });
    expect(activeCreditCount(edition.editionId)).toBe(1);
    expect(Number(queryValue(`select credited_distance_m from app.distance_credit where registration_id = '${ids.A}' and status = 'ACTIVE'`))).toBe(5000);

    const replay = await call(admin, { key: closeKey });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(closed.body.data);
    expect(activeCreditCount(edition.editionId)).toBe(1);
    const repeated = await call(admin);
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe("CONFLICT");
    expect(activeCreditCount(edition.editionId)).toBe(1);

    // Once closed, eligibility and finalization changes need the closure reopened first.
    const eligibilityBlocked = await callRoute(asHandler(resolveEligibilityPost), {
      path: `/api/v1/admin/registrations/${ids.A}/sporting-eligibility/resolve`,
      params: { id: ids.A },
      body: { status: "ELIGIBLE", distance_credit_disposition: "ALLOW" },
      as: operator.client,
    });
    expect(eligibilityBlocked.body.error).toMatchObject({ code: "CLOSURE_BLOCKED", details: { reason: "edition_closed" } });
    const finalizationBlocked = await callRoute(asHandler(reopenFinalizationPost), {
      path: `/api/v1/admin/editions/${edition.editionId}/attendance/reopen`,
      params,
      body: { reason: "Intento" },
      as: operator.client,
    });
    expect(finalizationBlocked.body.error).toMatchObject({ code: "CLOSURE_BLOCKED", details: { reason: "edition_closed" } });

    const workspace = await callRoute(asHandler(workspaceGet), { method: "GET", path: workspacePath(edition.editionId), params, as: operator.client });
    expect(workspace.body.data.current_closure).toMatchObject({ status: "CLOSED" });
    expect(workspace.body.data.close_readiness.checks.find((c: { code: string }) => c.code === "NOT_ALREADY_CLOSED")).toMatchObject({ ok: false });
    expect(workspace.body.data.participants.filter((p: { has_active_credit: boolean }) => p.has_active_credit)).toHaveLength(1);
  });

  test("reopen edition: reason mandatory, ADMIN only, reverses credits with history; a new close links the successor", async () => {
    const path = `/api/v1/admin/editions/${edition.editionId}/reopen`;
    const params = { editionId: edition.editionId };
    const call = (body: unknown, as: TestStaff | null, options: { key?: string | null } = {}) =>
      callRoute(asHandler(reopenEditionPost), { path, params, body, as: as?.client ?? null, key: options.key });

    expect((await call({ reason: "Corrección" }, operator)).status).toBe(403);
    expect((await call({ reason: "Corrección" }, otherAdmin)).status).toBe(403);
    expect((await call({}, admin)).status).toBe(400);

    const reopenKey = key("reopen");
    const reopened = await call({ reason: "Corrección de distancias" }, admin, { key: reopenKey });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data).toEqual({ edition_id: edition.editionId, reopened: true, reversed_credit_count: 1 });
    expect(activeCreditCount(edition.editionId)).toBe(0);
    expect(queryValue(`select status from app.distance_credit where registration_id = '${ids.A}'`)).toBe("REVERSED");
    expect(queryValue(`select closure_state from app.edition where edition_id = '${edition.editionId}'`)).toBe("PENDING");
    expect((await call({ reason: "Corrección de distancias" }, admin, { key: reopenKey })).body.data).toEqual(reopened.body.data);
    const notClosed = await call({ reason: "otra vez" }, admin);
    expect(notClosed.status).toBe(422);
    expect(notClosed.body.error.details.reason).toBe("not_closed");

    const closedAgain = await callRoute(asHandler(closePost), { path: `/api/v1/admin/editions/${edition.editionId}/close`, params, body: {}, as: admin.client });
    expect(closedAgain.status).toBe(200);
    expect(closedAgain.body.data).toMatchObject({ revision: 2, credits_created: 1 });
    expect(activeCreditCount(edition.editionId)).toBe(1);
    expect(Number(queryValue(`select count(*) from app.distance_credit where registration_id = '${ids.A}'`))).toBe(2);
    expect(
      queryValue(`select (select status from app.distance_credit p where p.distance_credit_id = c.supersedes_distance_credit_id) from app.distance_credit c where c.registration_id = '${ids.A}' and c.status = 'ACTIVE'`),
    ).toBe("REVERSED");
  });

  // ---- concurrency ----

  test("two concurrent close requests produce one effect and one CONFLICT; the winner's key replays", async () => {
    const path = `/api/v1/admin/editions/${other.editionId}/close`;
    const params = { editionId: other.editionId };
    for (const runner of other.runners) {
      const present = await callRoute(asHandler(resolveAttendancePost), {
        path: `/api/v1/admin/registrations/${runner.registrationId}/attendance/resolve`,
        params: { id: runner.registrationId },
        body: { status: "PRESENT", reason: "Llegó", evidence_metadata: evidence },
        as: operator.client,
      });
      expect(present.status).toBe(200);
    }
    const finalized = await callRoute(asHandler(finalizePost), { path: `/api/v1/admin/editions/${other.editionId}/attendance/finalize`, params, body: {}, as: operator.client });
    expect(finalized.status).toBe(200);

    const keyOne = key("close-race-1");
    const keyTwo = key("close-race-2");
    const [first, second] = await Promise.all([
      callRoute(asHandler(closePost), { path, params, body: {}, as: admin.client, key: keyOne }),
      callRoute(asHandler(closePost), { path, params, body: {}, as: secondAdmin.client, key: keyTwo }),
    ]);
    const outcomes = [first, second].sort((a, b) => a.status - b.status);
    expect(outcomes.map((o) => o.status)).toEqual([200, 409]);
    expect(outcomes[1].body.error.code).toBe("CONFLICT");
    expect(outcomes[0].body.data).toMatchObject({ status: "CLOSED", credits_created: 2 });

    expect(activeCreditCount(other.editionId)).toBe(2);
    expect(Number(queryValue(`select count(*) from app.administrative_closure where edition_id = '${other.editionId}' and status = 'CLOSED' and superseded_at is null`))).toBe(1);
    expect(Number(queryValue(`select count(*) from infra.outbox_event where event_type = 'EditionAdministrativelyClosed' and aggregate_id = '${other.editionId}'`))).toBe(1);

    // The winner retrying with its own key (timeout/retry) replays the stored response without a second effect.
    const winnerKey = first.status === 200 ? keyOne : keyTwo;
    const winnerClient = first.status === 200 ? admin.client : secondAdmin.client;
    const retry = await callRoute(asHandler(closePost), { path, params, body: {}, as: winnerClient, key: winnerKey });
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(outcomes[0].body.data);
    expect(activeCreditCount(other.editionId)).toBe(2);
  });
});
