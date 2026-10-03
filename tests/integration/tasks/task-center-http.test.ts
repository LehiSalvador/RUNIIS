import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cleanup, createCookieJar, createTestStaff, httpSignIn, sql } from "../helpers";
import { buildClosureEdition, finishEdition, type ClosureEdition } from "../closure/fixtures";

// P3-D over the real HTTP stack of a running dev server (APP_BASE_URL): real HttpOnly session cookies from the OTP flow, the auth proxy,
// Next routing of the new nested segments (static `refresh` beside `[id]`, `bulk-cancel`, `challenge` beside `[id]`) and the response
// headers. Behavioural coverage lives in the route-level tests next to this file; this one proves the wiring they bypass.

type Envelope = { data?: any; meta?: any; error?: { code: string; details: Record<string, any> } };

async function send(jar: ReturnType<typeof createCookieJar>, method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await jar.fetch(path, {
    method,
    headers: { ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Envelope, headers: response.headers };
}

describe("Task Center, bulk cancel and challenge over HTTP (P3-D) integration", () => {
  const authUserIds: string[] = [];
  let edition: ClosureEdition;

  beforeAll(async () => {
    sql(`delete from infra.rate_limit_counter where scope in ('auth.otp.ip', 'auth.verify.ip')`);
    const admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
    edition = await buildClosureEdition(admin.client, authUserIds, { runners: 1, label: "p3d-http" });
    finishEdition(edition.editionId);
  }, 120_000);

  afterAll(async () => {
    sql(`delete from app.admin_task where edition_id = '${edition.editionId}'`);
    await cleanup(authUserIds);
  });

  test("anonymous callers are refused; a real OPERATOR session lists, refreshes, starts and is bounded by Idempotency-Key and CSRF guards", async () => {
    const anon = createCookieJar();
    expect((await send(anon, "GET", "/api/v1/admin/tasks")).status).toBe(401);
    expect((await send(anon, "POST", "/api/v1/admin/tasks/refresh", { body: { edition_id: edition.editionId }, headers: { "idempotency-key": `http-${randomUUID()}` } })).status).toBe(401);
    expect((await send(anon, "GET", `/api/v1/registration-requests/challenge?edition_id=${edition.editionId}`)).status).toBe(401);

    const jar = createCookieJar();
    const authUserId = await httpSignIn(jar, `p3d-http-op-${Date.now()}@example.test`);
    authUserIds.push(authUserId);
    const staffMemberId = randomUUID();
    sql(`
      insert into app.staff_member (staff_member_id, auth_user_id, status) values ('${staffMemberId}', '${authUserId}', 'ACTIVE');
      insert into app.staff_role_assignment (staff_member_id, role, scope_type) values ('${staffMemberId}', 'OPERATOR', 'GLOBAL');
    `);

    expect((await send(jar, "POST", "/api/v1/admin/tasks/refresh", { body: { edition_id: edition.editionId } })).body.error?.details).toMatchObject({ header: "Idempotency-Key" });
    const refreshed = await send(jar, "POST", "/api/v1/admin/tasks/refresh", { body: { edition_id: edition.editionId }, headers: { "idempotency-key": `http-${randomUUID()}` } });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.opened).toBe(1);
    expect(refreshed.headers.get("cache-control")).toBe("private, no-store");

    const listed = await send(jar, "GET", `/api/v1/admin/tasks?edition_id=${edition.editionId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ source_rule: "attendance-finalization", blocking_level: "CLOSURE_BLOCKER", root: { section: "attendance" } });
    const taskId = listed.body.data[0].admin_task_id as string;

    expect((await send(jar, "GET", `/api/v1/admin/tasks/${taskId}`)).body.data.source_holds).toBe(true);
    const started = await send(jar, "POST", `/api/v1/admin/tasks/${taskId}/start`, { body: {}, headers: { "idempotency-key": `http-${randomUUID()}` } });
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe("IN_PROGRESS");
    const refused = await send(jar, "POST", `/api/v1/admin/tasks/${taskId}/resolve`, { body: { reason: "ya" }, headers: { "idempotency-key": `http-${randomUUID()}` } });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.details.reason).toBe("source_condition_open");

    // Cross-site POSTs are refused before anything runs.
    const crossSite = await send(jar, "POST", `/api/v1/admin/editions/${edition.editionId}/registration-requests/bulk-cancel`, {
      body: { request_ids: [randomUUID()], reason: "x" },
      headers: { "idempotency-key": `http-${randomUUID()}`, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);
    const bulk = await send(jar, "POST", `/api/v1/admin/editions/${edition.editionId}/registration-requests/bulk-cancel`, {
      body: { request_ids: [randomUUID()], reason: "Prueba HTTP" },
      headers: { "idempotency-key": `http-${randomUUID()}` },
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data).toMatchObject({ requested_count: 1, canceled_count: 0, rejected_count: 1 });
  }, 180_000); // the first hit of each route compiles it in the dev server
});
