import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, createTestStaff, queryValue, sql, type TestStaff } from "../helpers";
import { callRoute, type RouteHandler } from "../closure/harness";
import { buildClosureEdition, finishEdition, type ClosureEdition } from "../closure/fixtures";

// P3-D Task Center API (P3-AC-12, Master §142-143, Roadmap §9.26): list/filter, get, start, assign, resolve, waive, refresh over the real
// route modules (defineRoute) with real staff sessions against the local Postgres. Drives the real P3-C commands (finalize, close) so the
// tasks follow their sources, and proves a CLOSURE_BLOCKER is closed by its root and never by the task row.

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? sessionOrAnon(null) };
});

import { GET as listGet } from "@/app/api/v1/admin/tasks/route";
import { GET as taskGet } from "@/app/api/v1/admin/tasks/[id]/route";
import { POST as startPost } from "@/app/api/v1/admin/tasks/[id]/start/route";
import { POST as assignPost } from "@/app/api/v1/admin/tasks/[id]/assign/route";
import { POST as resolvePost } from "@/app/api/v1/admin/tasks/[id]/resolve/route";
import { POST as waivePost } from "@/app/api/v1/admin/tasks/[id]/waive/route";
import { POST as refreshPost } from "@/app/api/v1/admin/tasks/refresh/route";
import { GET as workspaceGet } from "@/app/api/v1/admin/editions/[editionId]/attendance/route";
import { POST as finalizePost } from "@/app/api/v1/admin/editions/[editionId]/attendance/finalize/route";
import { POST as closePost } from "@/app/api/v1/admin/editions/[editionId]/close/route";

const asHandler = (route: unknown) => route as RouteHandler;

describe("Task Center API (P3-D) integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let operator: TestStaff;
  let checkin: TestStaff;
  let moderator: TestStaff;
  let otherOperator: TestStaff;
  let edition: ClosureEdition;
  let other: ClosureEdition;
  let attendanceTaskId: string;
  let integrityCaseId: string;
  let integrityTaskId: string;

  const list = (query: string, as: TestStaff | null) => callRoute(asHandler(listGet), { method: "GET", path: `/api/v1/admin/tasks?${query}`, as: as?.client ?? null });
  const get = (id: string, as: TestStaff | null) => callRoute(asHandler(taskGet), { method: "GET", path: `/api/v1/admin/tasks/${id}`, params: { id }, as: as?.client ?? null });
  const act = (route: unknown, action: string, id: string, body: unknown, as: TestStaff | null, key?: string | null) =>
    callRoute(asHandler(route), { path: `/api/v1/admin/tasks/${id}/${action}`, params: { id }, body, as: as?.client ?? null, key });
  const refresh = (editionId: string, as: TestStaff | null, key?: string | null) =>
    callRoute(asHandler(refreshPost), { path: "/api/v1/admin/tasks/refresh", body: { edition_id: editionId }, as: as?.client ?? null, key });
  const taskStatus = (id: string) => queryValue(`select status from app.admin_task where admin_task_id = '${id}'`);
  const taskIdByKey = (key: string) => queryValue(`select admin_task_id from app.admin_task where task_key = '${key}'`);

  beforeAll(async () => {
    admin = await createTestStaff("ADMIN", "GLOBAL");
    operator = await createTestStaff("OPERATOR", "GLOBAL");
    checkin = await createTestStaff("CHECKIN", "GLOBAL");
    moderator = await createTestStaff("MODERATOR", "GLOBAL");
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId, moderator.authUserId);
    edition = await buildClosureEdition(admin.client, authUserIds, { runners: 2, label: "p3d-tasks" });
    other = await buildClosureEdition(admin.client, authUserIds, { runners: 0, label: "p3d-tasks-other" });
    otherOperator = await createTestStaff("OPERATOR", "EDITION", other.editionId);
    authUserIds.push(otherOperator.authUserId);
    finishEdition(edition.editionId);
    integrityCaseId = randomUUID();
    sql(`insert into app.community_integrity_case (community_integrity_case_id, case_type, edition_id, status, severity, blocking_level)
         values ('${integrityCaseId}', 'DISTANCE_MISMATCH', '${edition.editionId}', 'OPEN', 'HIGH', 'BLOCKS_CLOSURE')`);
  }, 240_000);

  afterAll(async () => {
    sql(`delete from app.admin_task where edition_id in ('${edition.editionId}', '${other.editionId}')`);
    await cleanup(authUserIds);
  });

  test("refresh projects the attendance and integrity tasks; staff only, Idempotency-Key required, scope enforced", async () => {
    expect((await refresh(edition.editionId, null)).status).toBe(401);
    expect((await refresh(edition.editionId, checkin)).status).toBe(403);
    expect((await refresh(edition.editionId, moderator)).status).toBe(403);
    expect((await refresh(edition.editionId, otherOperator)).status).toBe(403);
    expect((await refresh(edition.editionId, operator, null)).body.error.code).toBe("VALIDATION_ERROR");

    const key = `p3d-refresh-${randomUUID()}`;
    const first = await refresh(edition.editionId, operator, key);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ edition_id: edition.editionId, opened: 2, cleared: 0, errors: 0 });
    expect((await refresh(edition.editionId, operator, key)).body).toEqual(first.body);
    const second = await refresh(edition.editionId, operator);
    expect(second.body.data.opened).toBe(0);

    attendanceTaskId = taskIdByKey(`attendance-finalization:${edition.editionId}`)!;
    integrityTaskId = taskIdByKey(`closure-integrity:${edition.editionId}:${integrityCaseId}`)!;
    expect(attendanceTaskId).toBeTruthy();
    expect(integrityTaskId).toBeTruthy();
  });

  test("list: blockers first, root-object hint, filters, role-scoped visibility, pagination", async () => {
    const all = await list(`edition_id=${edition.editionId}`, operator);
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data[0].blocking_level).toBe("CLOSURE_BLOCKER");
    const attendance = all.body.data.find((t: any) => t.task_key.startsWith("attendance-finalization:"));
    expect(attendance.root).toEqual({ section: "attendance", edition_id: edition.editionId, entity_type: "edition", entity_id: edition.editionId });
    const integrity = all.body.data.find((t: any) => t.task_key.startsWith("closure-integrity:"));
    expect(integrity.root).toEqual({ section: "integrity", edition_id: edition.editionId, entity_type: "community_integrity_case", entity_id: integrityCaseId });
    expect(all.body.meta.counts.active_by_blocking_level).toEqual({ CLOSURE_BLOCKER: 2 });

    expect((await list(`edition_id=${edition.editionId}&category=INTEGRITY`, admin)).body.data).toHaveLength(1);
    expect((await list(`edition_id=${edition.editionId}&blocking_level=INFORMATION`, admin)).body.data).toHaveLength(0);
    expect((await list(`edition_id=${edition.editionId}&assigned=unassigned`, admin)).body.data).toHaveLength(2);
    expect((await list(`edition_id=${edition.editionId}&assigned=me`, admin)).body.data).toHaveLength(0);

    const page1 = await list(`edition_id=${edition.editionId}&limit=1`, admin);
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.meta.next_cursor).toBeTruthy();
    const page2 = await list(`edition_id=${edition.editionId}&limit=1&cursor=${encodeURIComponent(page1.body.meta.next_cursor)}`, admin);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].admin_task_id).not.toBe(page1.body.data[0].admin_task_id);
    expect(page2.body.meta.next_cursor).toBeNull();

    // Role scope: CHECKIN and MODERATOR see none of these operational tasks; another Edition's operator cannot read this Edition.
    expect((await list(`edition_id=${edition.editionId}`, checkin)).body.data).toHaveLength(0);
    expect((await list(`edition_id=${edition.editionId}`, moderator)).body.data).toHaveLength(0);
    expect((await list(`edition_id=${edition.editionId}`, otherOperator)).status).toBe(403);
    expect((await list("", otherOperator)).body.data.filter((t: any) => t.edition_id === edition.editionId)).toHaveLength(0);
    expect((await list("", null)).status).toBe(401);
    expect((await list("status=NOPE", admin)).body.error.code).toBe("VALIDATION_ERROR");
    expect((await get(attendanceTaskId, checkin)).status).toBe(404);
    expect((await get(attendanceTaskId, otherOperator)).status).toBe(403);
  });

  test("get reports whether the root still holds; start and assign are idempotent and scoped", async () => {
    const detail = await get(attendanceTaskId, operator);
    expect(detail.body.data).toMatchObject({ admin_task_id: attendanceTaskId, source_holds: true, status: "OPEN" });

    expect((await act(startPost, "start", attendanceTaskId, {}, checkin)).status).toBe(403);
    expect((await act(startPost, "start", attendanceTaskId, {}, otherOperator)).status).toBe(403);
    expect((await act(startPost, "start", attendanceTaskId, {}, operator, null)).body.error.code).toBe("VALIDATION_ERROR");
    const key = `p3d-start-${randomUUID()}`;
    const started = await act(startPost, "start", attendanceTaskId, {}, operator, key);
    expect(started.body.data).toMatchObject({ status: "IN_PROGRESS", assigned_staff_id: operator.staffMemberId });
    expect((await act(startPost, "start", attendanceTaskId, {}, operator, key)).body).toEqual(started.body);
    expect((await act(startPost, "start", attendanceTaskId, {}, operator)).body.error.details).toMatchObject({ reason: "invalid_transition" });

    const assigned = await act(assignPost, "assign", attendanceTaskId, { assignee_id: admin.staffMemberId, assigned_role: "ADMIN" }, operator);
    expect(assigned.body.data).toMatchObject({ assigned_staff_id: admin.staffMemberId, assigned_role: "ADMIN" });
    expect((await act(assignPost, "assign", attendanceTaskId, { assignee_id: otherOperator.staffMemberId }, operator)).body.error.details).toMatchObject({ field: "assignee_id" });
    expect((await list(`edition_id=${edition.editionId}&assigned=me`, admin)).body.data).toHaveLength(1);
  });

  test("a CLOSURE_BLOCKER is closed by its source, never by staff: resolve and waive are refused while it holds", async () => {
    for (const [route, action] of [[resolvePost, "resolve"], [waivePost, "waive"]] as const) {
      const refused = await act(route, action, attendanceTaskId, { reason: "ya está" }, admin);
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(refused.body.error.details).toMatchObject({ reason: "source_condition_open", related_entity_type: "edition", related_entity_id: edition.editionId });
    }
    expect((await act(resolvePost, "resolve", attendanceTaskId, { reason: "  " }, admin)).body.error.code).toBe("VALIDATION_ERROR");
    expect(taskStatus(attendanceTaskId)).toBe("IN_PROGRESS");
    const integrityRefused = await act(waivePost, "waive", integrityTaskId, { reason: "no aplica" }, admin);
    expect(integrityRefused.body.error.details.reason).toBe("source_condition_open");
  });

  test("the sources clear: finalize clears the attendance task, closing the case clears the integrity task, close clears the closure task", async () => {
    // Finalize through the real P3-C command (mark the remaining participants NO_SHOW), then recompute.
    expect((await callRoute(asHandler(workspaceGet), { method: "GET", path: `/api/v1/admin/editions/${edition.editionId}/attendance`, params: { editionId: edition.editionId }, as: admin.client })).status).toBe(200);
    const finalized = await callRoute(asHandler(finalizePost), {
      path: `/api/v1/admin/editions/${edition.editionId}/attendance/finalize`,
      params: { editionId: edition.editionId },
      body: { mark_remaining_no_show: true, reason: "Cierre de prueba" },
      as: admin.client,
    });
    expect(finalized.status).toBe(200);
    expect(taskStatus(attendanceTaskId)).toBe("IN_PROGRESS"); // a projection: nothing changes until it is recomputed

    sql(`update app.community_integrity_case set status = 'RESOLVED', resolved_at = now(), resolution = 'ok' where community_integrity_case_id = '${integrityCaseId}'`);
    const refreshed = await refresh(edition.editionId, admin);
    expect(refreshed.body.data).toMatchObject({ opened: 1, cleared: 2 });
    expect(queryValue(`select status || '/' || resolution_type from app.admin_task where admin_task_id = '${attendanceTaskId}'`)).toBe("RESOLVED/CONDITION_CLEARED");
    expect(queryValue(`select status || '/' || resolution_type from app.admin_task where admin_task_id = '${integrityTaskId}'`)).toBe("RESOLVED/CONDITION_CLEARED");

    const closureTaskId = taskIdByKey(`closure-pending:${edition.editionId}`)!;
    const closureTask = await get(closureTaskId, admin);
    expect(closureTask.body.data).toMatchObject({ blocking_level: "ACTION_REQUIRED", status: "OPEN", source_holds: true, root: { section: "closure" } });
    expect(closureTask.body.data.metadata.ready).toBe(true);

    const closed = await callRoute(asHandler(closePost), { path: `/api/v1/admin/editions/${edition.editionId}/close`, params: { editionId: edition.editionId }, body: {}, as: admin.client });
    expect(closed.status).toBe(200);
    expect((await refresh(edition.editionId, admin)).body.data.cleared).toBe(1);
    expect(taskStatus(closureTaskId)).toBe("RESOLVED");
    expect((await get(closureTaskId, admin)).body.data.source_holds).toBe(false);
  });

  test("non-blocking tasks are resolved or waived by staff with a reason, audited, and stay closed", async () => {
    const infoKey = `race-day-burst:${edition.editionId}:p3d`;
    sql(`insert into app.admin_task (task_key, category, scope_type, scope_id, edition_id, title, description, priority, blocking_level, source_rule)
         values ('${infoKey}', 'RACE_DAY', 'EDITION', '${edition.editionId}', '${edition.editionId}', 'Aviso', 'Aviso de prueba', 'NORMAL', 'INFORMATION', 'raceday_unknown_pass_burst'),
                ('${infoKey}-2', 'RACE_DAY', 'EDITION', '${edition.editionId}', '${edition.editionId}', 'Aviso 2', 'Aviso de prueba', 'NORMAL', 'ACTION_REQUIRED', 'raceday_unknown_pass_burst')`);
    const [a, b] = [taskIdByKey(infoKey)!, taskIdByKey(`${infoKey}-2`)!];

    // CHECKIN reads race-day tasks of its scope but cannot mutate them.
    expect((await list(`edition_id=${edition.editionId}`, checkin)).body.data).toHaveLength(2);
    expect((await act(resolvePost, "resolve", a, { reason: "x" }, checkin)).status).toBe(403);

    const resolved = await act(resolvePost, "resolve", a, { reason: "Revisado en sitio" }, operator);
    expect(resolved.body.data).toMatchObject({ status: "RESOLVED", resolution_type: "MANUAL", resolution_reason: "Revisado en sitio" });
    expect((await act(resolvePost, "resolve", a, { reason: "otra vez" }, operator)).body.error.details).toMatchObject({ reason: "invalid_transition" });
    const waived = await act(waivePost, "waive", b, { reason: "Falsa alarma" }, admin);
    expect(waived.body.data).toMatchObject({ status: "WAIVED", resolution_type: "WAIVED" });
    expect((await list(`edition_id=${edition.editionId}`, admin)).body.data.find((t: any) => t.admin_task_id === a)).toBeUndefined();
    expect((await list(`edition_id=${edition.editionId}&status=ALL`, admin)).body.data.find((t: any) => t.admin_task_id === a)).toBeTruthy();

    expect(Number(queryValue(`select count(*) from audit.audit_log where entity_type = 'admin_task' and entity_id in ('${a}', '${b}', '${attendanceTaskId}')`))).toBeGreaterThanOrEqual(4);
    expect(queryValue(`select actor_staff_member_id from audit.audit_log where action = 'ADMIN_TASK_WAIVED' and entity_id = '${b}'`)).toBe(admin.staffMemberId);
  });
});
