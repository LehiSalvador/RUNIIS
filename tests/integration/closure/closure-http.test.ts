import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cleanup, createCookieJar, createTestStaff, httpSignIn, queryValue, sql } from "../helpers";
import { buildClosureEdition, finishEdition, type ClosureEdition } from "./fixtures";

// P3-C over the real HTTP stack of a running dev server (APP_BASE_URL, default http://127.0.0.1:3100): real HttpOnly session
// cookies from the OTP flow, the auth proxy, Next routing of the nested dynamic segments and the response headers. The
// behavioural coverage lives in the route-level tests next to this file; this one proves the wiring they bypass.

type Envelope = { data?: Record<string, any>; error?: { code: string; details: Record<string, any> } };

async function send(jar: ReturnType<typeof createCookieJar>, method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await jar.fetch(path, {
    method,
    headers: { ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Envelope, headers: response.headers };
}

describe("closure APIs over HTTP (P3-C) integration", () => {
  const authUserIds: string[] = [];
  let edition: ClosureEdition;

  beforeAll(async () => {
    sql(`delete from infra.rate_limit_counter where scope in ('auth.otp.ip', 'auth.verify.ip')`);
    const admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
    edition = await buildClosureEdition(admin.client, authUserIds, { runners: 2, label: "p3c-http" });
    finishEdition(edition.editionId);
  }, 120_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  test("staff session: workspace GET, resolve, mandatory Idempotency-Key, ADMIN-only close, CSRF and prefetch guards", async () => {
    const jar = createCookieJar();
    const anon = createCookieJar();
    const editionId = edition.editionId;
    const registrationId = edition.runners[0].registrationId;
    const workspace = `/api/v1/admin/editions/${editionId}/attendance`;

    expect((await send(anon, "GET", workspace)).status).toBe(401);
    expect((await send(anon, "POST", `/api/v1/admin/editions/${editionId}/close`, { body: {}, headers: { "idempotency-key": `http-${randomUUID()}` } })).status).toBe(401);

    // A real OPERATOR session over the OTP flow.
    const email = `p3c-http-op-${Date.now()}@example.test`;
    const authUserId = await httpSignIn(jar, email);
    authUserIds.push(authUserId);
    const staffMemberId = randomUUID();
    sql(`
      insert into app.staff_member (staff_member_id, auth_user_id, status) values ('${staffMemberId}', '${authUserId}', 'ACTIVE');
      insert into app.staff_role_assignment (staff_member_id, role, scope_type) values ('${staffMemberId}', 'OPERATOR', 'GLOBAL');
    `);

    const ok = await send(jar, "GET", workspace);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.body.data).toMatchObject({ edition_id: editionId, universe_count: 2, participants_truncated: false });
    // Speculative requests never reach the writing sync.
    expect((await send(jar, "GET", workspace, { headers: { "sec-purpose": "prefetch" } })).status).toBe(403);
    expect((await send(jar, "GET", workspace, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);

    const resolve = `/api/v1/admin/registrations/${registrationId}/attendance/resolve`;
    const body = { status: "PRESENT", reason: "Llegó", evidence_metadata: { method: "MANUAL_DESK" } };
    const noKey = await send(jar, "POST", resolve, { body });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error!.details).toMatchObject({ header: "Idempotency-Key", reason: "missing" });
    expect((await send(jar, "POST", resolve, { body, headers: { "idempotency-key": `http-${randomUUID()}`, "sec-fetch-site": "cross-site" } })).status).toBe(403);
    const resolved = await send(jar, "POST", resolve, { body, headers: { "idempotency-key": `http-${randomUUID()}` } });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ registration_id: registrationId, status: "PRESENT", source: "MANUAL" });
    expect(queryValue(`select status from app.attendance_resolution where registration_id = '${registrationId}' and superseded_at is null`)).toBe("PRESENT");

    // EDITION_CLOSURE_MANAGE is ADMIN only: an OPERATOR is refused before anything runs.
    const close = await send(jar, "POST", `/api/v1/admin/editions/${editionId}/close`, { body: {}, headers: { "idempotency-key": `http-${randomUUID()}` } });
    expect(close.status).toBe(403);
    expect(close.body.error!.code).toBe("FORBIDDEN");
    // The remaining routes are wired (blocked by state/validation, not by routing).
    const cancelInvalid = await send(jar, "POST", `/api/v1/admin/registrations/${edition.runners[1].registrationId}/cancel`, { body: {}, headers: { "idempotency-key": `http-${randomUUID()}` } });
    expect(cancelInvalid.status).toBe(400);
    expect(cancelInvalid.body.error!.code).toBe("VALIDATION_ERROR");
    const finalizeBlocked = await send(jar, "POST", `/api/v1/admin/editions/${editionId}/attendance/finalize`, { body: {}, headers: { "idempotency-key": `http-${randomUUID()}` } });
    expect(finalizeBlocked.status).toBe(422);
    expect(finalizeBlocked.body.error!.details.reason).toBe("not_ready");
  }, 180_000);
});
