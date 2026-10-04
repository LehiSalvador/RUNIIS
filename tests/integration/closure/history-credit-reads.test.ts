import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, createTestStaff, queryValue, type TestStaff } from "../helpers";
import { callRoute, sessionStore, type RouteHandler } from "./harness";
import { buildClosureEdition, finishEdition, type ClosureEdition } from "./fixtures";

// P3-T read APIs (P3-AC-03, P3-AC-11): the finalization / closure revision history and the DistanceCredit ledger, plus the credited distance on
// the attendance workspace. Real route modules + real signed-in staff sessions + real local Postgres (defineRoute end to end). The history is
// built through the real command routes: finalize, close, reopen the closure, reopen the finalization, correct one runner, finalize, close.

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
import { GET as historyGet } from "@/app/api/v1/admin/editions/[editionId]/closure-history/route";
import { GET as creditsGet } from "@/app/api/v1/admin/editions/[editionId]/credits/route";

void sessionStore;
const asHandler = (route: unknown) => route as RouteHandler;
const evidence = { method: "MANUAL_DESK" };

describe("closure history and credit ledger reads (P3-T) integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let operator: TestStaff;
  let checkin: TestStaff;
  let otherOperator: TestStaff;
  let edition: ClosureEdition;
  let other: ClosureEdition;
  let ids: string[];

  const base = (editionId: string) => `/api/v1/admin/editions/${editionId}`;
  const params = () => ({ editionId: edition.editionId });
  const history = (kind: string | null, as: TestStaff | null, query = "", editionId = edition.editionId) =>
    callRoute(asHandler(historyGet), {
      method: "GET",
      path: `${base(editionId)}/closure-history?${kind === null ? "" : `kind=${kind}`}${query}`,
      params: { editionId },
      as: as?.client ?? null,
    });
  const credits = (as: TestStaff | null, query = "", editionId = edition.editionId) =>
    callRoute(asHandler(creditsGet), { method: "GET", path: `${base(editionId)}/credits?${query}`, params: { editionId }, as: as?.client ?? null });
  const present = (registrationId: string, status: "PRESENT" | "NO_SHOW") =>
    callRoute(asHandler(resolveAttendancePost), {
      path: `/api/v1/admin/registrations/${registrationId}/attendance/resolve`,
      params: { id: registrationId },
      body: status === "PRESENT" ? { status, reason: "Llegó", evidence_metadata: evidence } : { status },
      as: operator.client,
    });
  const command = (route: unknown, suffix: string, body: unknown, as: TestStaff) =>
    callRoute(asHandler(route), { path: `${base(edition.editionId)}${suffix}`, params: params(), body, as: as.client });

  beforeAll(async () => {
    admin = await createTestStaff("ADMIN", "GLOBAL");
    operator = await createTestStaff("OPERATOR", "GLOBAL");
    checkin = await createTestStaff("CHECKIN", "GLOBAL");
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId);
    edition = await buildClosureEdition(admin.client, authUserIds, { runners: 3, label: "p3t" });
    other = await buildClosureEdition(admin.client, authUserIds, { runners: 1, label: "p3t-other" });
    otherOperator = await createTestStaff("OPERATOR", "EDITION", other.editionId);
    authUserIds.push(otherOperator.authUserId);
    ids = edition.runners.map((runner) => runner.registrationId);
    finishEdition(edition.editionId);
    finishEdition(other.editionId);

    // Reconcile the universe, then build the history through the real commands.
    expect((await callRoute(asHandler(workspaceGet), { method: "GET", path: `${base(edition.editionId)}/attendance`, params: params(), as: operator.client })).status).toBe(200);
    for (const id of ids) expect((await present(id, "PRESENT")).status).toBe(200);
    expect((await command(finalizePost, "/attendance/finalize", {}, operator)).body.data.revision).toBe(1);
    expect((await command(closePost, "/close", {}, admin)).body.data).toMatchObject({ revision: 1, credits_created: 3 });
    expect((await command(reopenEditionPost, "/reopen", { reason: "Error en la lista de PRESENT" }, admin)).body.data.reversed_credit_count).toBe(3);
    expect((await command(reopenFinalizationPost, "/attendance/reopen", { reason: "Corrección de lista" }, operator)).status).toBe(200);
    expect((await present(ids[0], "NO_SHOW")).status).toBe(200);
    expect((await command(finalizePost, "/attendance/finalize", {}, operator)).body.data).toMatchObject({ revision: 2, present_count: 2, no_show_count: 1 });
    expect((await command(closePost, "/close", {}, admin)).body.data).toMatchObject({ revision: 2, credits_created: 2 });
  }, 300_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  test("access: staff scope only, validated query, never cached", async () => {
    expect((await history("FINALIZATION", null)).status).toBe(401);
    expect((await credits(null)).status).toBe(401);
    for (const denied of [checkin, otherOperator]) {
      for (const response of [await history("FINALIZATION", denied), await history("CLOSURE", denied), await credits(denied)]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("FORBIDDEN");
      }
    }
    // The Edition-scoped operator reads their own Edition (empty before any closure).
    const own = await credits(otherOperator, "", other.editionId);
    expect(own.status).toBe(200);
    expect(own.body.data).toEqual([]);
    expect((await history("CLOSURE", otherOperator, "", other.editionId)).body.meta.total).toBe(0);

    expect((await history(null, operator)).status).toBe(400); // kind is required
    expect((await history("OTHER", operator)).status).toBe(400);
    expect((await history("CLOSURE", operator, "&limit=0")).status).toBe(400);
    expect((await history("CLOSURE", operator, "&limit=101")).status).toBe(400);
    expect((await history("CLOSURE", operator, "&extra=1")).status).toBe(400);
    expect((await credits(operator, "status=PENDING")).status).toBe(400);
    expect((await credits(operator, "modality_id=nope")).status).toBe(400);
    expect((await credits(operator, "search=ana")).status).toBe(400);
    const badId = await callRoute(asHandler(creditsGet), { method: "GET", path: `${base("not-a-uuid")}/credits`, params: { editionId: "not-a-uuid" }, as: operator.client });
    expect(badId.status).toBe(400);
    const unknown = await credits(admin, "", randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("NOT_FOUND");

    for (const response of [await history("FINALIZATION", operator), await credits(operator)]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-request-id")).toBeTruthy();
    }
    // A speculative request is harmless here (the reads write nothing), unlike the workspace GET.
    const speculative = await callRoute(asHandler(creditsGet), {
      method: "GET",
      path: `${base(edition.editionId)}/credits`,
      params: params(),
      as: operator.client,
      headers: { "sec-purpose": "prefetch" },
    });
    expect(speculative.status).toBe(200);
  });

  test("finalization and closure history: revisions, actors, reasons, counts", async () => {
    const finalizations = await history("FINALIZATION", operator);
    expect(finalizations.status).toBe(200);
    expect(finalizations.body.meta).toMatchObject({ total: 2, next_cursor: null });
    const [current, superseded] = finalizations.body.data;
    expect(current).toMatchObject({ revision: 2, status: "FINALIZED", is_current: true, expected_count: 3, present_count: 2, no_show_count: 1, excluded_count: 0, superseded_at: null, reopen_reason: null });
    expect(superseded).toMatchObject({ revision: 1, status: "SUPERSEDED", is_current: false, present_count: 3, reopen_reason: "Corrección de lista" });
    expect(superseded.superseded_at).toBeTruthy();
    expect(superseded.reopened_by_staff_id).toBe(operator.staffMemberId);
    // Staff labels are viewer-safe text, never an email.
    expect(current.finalized_by_staff_label).toEqual(expect.any(String));
    expect(JSON.stringify(finalizations.body)).not.toContain("@example.test");

    const closures = await history("CLOSURE", admin);
    expect(closures.body.meta).toMatchObject({ total: 2, next_cursor: null });
    const [closure2, closure1] = closures.body.data;
    expect(closure2).toMatchObject({ revision: 2, status: "CLOSED", is_current: true, attendance_finalization_revision: 2, credit_count: 2, active_credit_count: 2, reversed_credit_count: 0, active_credited_distance_m: 10000 });
    expect(closure1).toMatchObject({ revision: 1, status: "SUPERSEDED", is_current: false, attendance_finalization_revision: 1, credit_count: 3, active_credit_count: 0, reversed_credit_count: 3, active_credited_distance_m: 0, reopen_reason: "Error en la lista de PRESENT" });
    expect(closure1.reopened_by_staff_id).toBe(admin.staffMemberId);
    expect(closure2.closed_by_staff_id).toBe(admin.staffMemberId);

    // Keyset pagination by revision.
    const first = await history("FINALIZATION", operator, "&limit=1");
    expect(first.body.data.map((row: { revision: number }) => row.revision)).toEqual([2]);
    expect(first.body.meta.next_cursor).toEqual(expect.any(String));
    const second = await history("FINALIZATION", operator, `&limit=1&cursor=${first.body.meta.next_cursor}`);
    expect(second.body.data.map((row: { revision: number }) => row.revision)).toEqual([1]);
    expect(second.body.meta.next_cursor).toBeNull();
    // A garbled cursor restarts at the first page instead of failing.
    expect((await history("CLOSURE", operator, "&limit=1&cursor=%21%21%21")).body.data[0].revision).toBe(2);
  });

  test("credit ledger: chain, filters, participant labels without contact data, summary, keyset pages", async () => {
    const all = await credits(operator);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(5);
    expect(all.body.meta.summary).toMatchObject({ total_m: 10000, active_credit_count: 2, reversed_credit_count: 3 });
    // Every crediting modality is listed, also the one without credits yet (the second 10K, zero).
    expect(all.body.meta.summary.by_modality).toHaveLength(2);
    expect(all.body.meta.summary.by_modality).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modality_id: edition.modalityId, active_credit_count: 2, reversed_credit_count: 3, credited_distance_m: 10000 }),
        expect.objectContaining({ modality_id: edition.secondModalityId, active_credit_count: 0, reversed_credit_count: 0, credited_distance_m: 0 }),
      ]),
    );
    const rows: any[] = all.body.data;
    expect(rows.map((row) => row.closure_revision)).toEqual([2, 2, 1, 1, 1]);
    const active = rows.filter((row) => row.status === "ACTIVE");
    expect(active.map((row) => row.registration_id).sort()).toEqual([ids[1], ids[2]].sort());
    for (const row of active) {
      expect(row).toMatchObject({ participant_kind: "PROFILE", official_distance_snapshot_m: 5000, credited_distance_m: 5000, source: "EVENT_ATTENDANCE", reversed_at: null, reversal_reason: null });
      expect(row.sport_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.sport_timezone).toEqual(expect.any(String));
      expect(row.modality).toMatchObject({ modality_id: edition.modalityId });
      expect(row.participant_label).toMatch(/^Persona p3t-/);
      // The new credit points at its reversed predecessor, which names it back.
      const predecessor = rows.find((candidate) => candidate.distance_credit_id === row.supersedes_distance_credit_id);
      expect(predecessor).toMatchObject({ status: "REVERSED", registration_id: row.registration_id, superseded_by_distance_credit_id: row.distance_credit_id });
    }
    const corrected = rows.find((row) => row.registration_id === ids[0]);
    expect(corrected).toMatchObject({ status: "REVERSED", reversal_reason: "Error en la lista de PRESENT", superseded_by_distance_credit_id: null, supersedes_distance_credit_id: null });
    expect(corrected.reversed_by_staff_label).toEqual(expect.any(String));
    // Participant contact data never travels with the ledger.
    const text = JSON.stringify(all.body);
    for (const user of edition.runners) expect(text).not.toContain(user.user.email);
    expect(text).not.toMatch(/phone|email|emergency/i);

    // Filters.
    expect((await credits(operator, "status=ACTIVE")).body.meta.total).toBe(2);
    expect((await credits(operator, "status=REVERSED")).body.meta.total).toBe(3);
    expect((await credits(operator, `modality_id=${edition.secondModalityId}`)).body.meta.total).toBe(0);
    expect((await credits(operator, `registration_id=${ids[1]}`)).body.data.map((row: { status: string }) => row.status).sort()).toEqual(["ACTIVE", "REVERSED"]);
    // The summary ignores the filters (Edition-wide).
    expect((await credits(operator, "status=REVERSED")).body.meta.summary.total_m).toBe(10000);

    // Keyset pages of two: 2 + 2 + 1, no overlap, stable order.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof credits>> = await credits(operator, `limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(page.status).toBe(200);
      seen.push(...page.body.data.map((row: { distance_credit_id: string }) => row.distance_credit_id));
      cursor = page.body.meta.next_cursor;
      pages += 1;
    } while (cursor && pages < 5);
    expect(pages).toBe(3);
    expect(seen).toEqual(rows.map((row) => row.distance_credit_id));
  });

  test("workspace: credited distance per modality is additive, and the reads wrote nothing", async () => {
    const counts = () =>
      [
        queryValue(`select count(*) from app.distance_credit where edition_id = '${edition.editionId}'`),
        queryValue(`select count(*) from app.administrative_closure where edition_id = '${edition.editionId}'`),
        queryValue(`select count(*) from audit.audit_log where edition_id = '${edition.editionId}'`),
        queryValue(`select count(*) from infra.outbox_event where payload ->> 'edition_id' = '${edition.editionId}'`),
      ].join("/");
    const before = counts();
    const ledger = await credits(operator);
    await history("CLOSURE", operator);
    await history("FINALIZATION", operator);
    expect(counts()).toBe(before);

    const workspace = await callRoute(asHandler(workspaceGet), { method: "GET", path: `${base(edition.editionId)}/attendance`, params: params(), as: operator.client });
    expect(workspace.status).toBe(200);
    // The pre-existing keys are untouched.
    expect(workspace.body.data).toMatchObject({ edition_id: edition.editionId, universe_count: 3, participants_truncated: false });
    expect(workspace.body.data.current_closure).toMatchObject({ revision: 2, status: "CLOSED" });
    expect(workspace.body.data.credited_distance).toEqual(ledger.body.meta.summary);
    expect(workspace.body.data.credited_distance.total_m).toBe(10000);
  });
});
