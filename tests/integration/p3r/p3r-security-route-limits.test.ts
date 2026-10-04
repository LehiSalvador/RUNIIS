import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createEdition, createEvent, createModality } from "@/lib/server/domain/events/service";
import { createManualRevision, createRoute } from "@/lib/server/domain/routes/service";
import { encodeCursor } from "@/lib/server/http/pagination";
import { cleanup, createTestStaff, createTestUser, queryValue, sql, type TestStaff, type TestUser } from "../helpers";
import { sessionOrAnon, sessionStore } from "../closure/harness";
import { buildClosureEdition, finishEdition, type ClosureEdition } from "../closure/fixtures";
import { buildEdition, selfAcceptance, type EditionFixture } from "../registration/helpers";

// P3-R (P3-AC-07, P3-AC-13, P3-AC-18, P3-AC-03/14): the backend security findings and the route-editor limits proved over the REAL route modules
// (defineRoute: same-origin guard, auth, actor rate limit, zod, Idempotency-Key, envelope, error mapping) with real signed-in staff against the
// local Postgres. The SQL rules have their own pgTAP files (780, 781); this file proves the wiring a database test cannot.

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon: orAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? orAnon(null) };
});

import { PATCH as revisionPatch } from "@/app/api/v1/admin/route-revisions/[revisionId]/route";
import { POST as revisionsPost } from "@/app/api/v1/admin/routes/[routeId]/revisions/route";
import { GET as tasksGet } from "@/app/api/v1/admin/tasks/route";
import { GET as taskGet } from "@/app/api/v1/admin/tasks/[id]/route";
import { POST as taskWaivePost } from "@/app/api/v1/admin/tasks/[id]/waive/route";
import { POST as tasksRefreshPost } from "@/app/api/v1/admin/tasks/refresh/route";
import { GET as requestsGet } from "@/app/api/v1/admin/editions/[editionId]/registration-requests/route";
import { GET as workspaceGet } from "@/app/api/v1/admin/editions/[editionId]/attendance/route";
import { POST as finalizePost } from "@/app/api/v1/admin/editions/[editionId]/attendance/finalize/route";
import { POST as closePost } from "@/app/api/v1/admin/editions/[editionId]/close/route";
import { POST as reopenPost } from "@/app/api/v1/admin/editions/[editionId]/reopen/route";
import { POST as resolveAttendancePost } from "@/app/api/v1/admin/registrations/[id]/attendance/resolve/route";
import { POST as cancelRegistrationPost } from "@/app/api/v1/admin/registrations/[id]/cancel/route";
import { POST as createRequestPost } from "@/app/api/v1/registration-requests/route";
import { POST as checkInPost } from "@/app/api/v1/check-in/route";
import { GET as policyGet, PATCH as policyPatch } from "@/app/api/v1/admin/anti-hoarding-policy/route";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;
type Res = { status: number; body: any; headers: Headers };
const ORIGIN = process.env.APP_BASE_URL ?? "http://127.0.0.1:3100";

async function call(
  handler: unknown,
  o: { method?: "GET" | "POST" | "PATCH"; path: string; params?: Record<string, string>; body?: unknown; rawBody?: string; key?: string | null; as: SupabaseClient | null },
): Promise<Res> {
  const method = o.method ?? "POST";
  const headers: Record<string, string> = {};
  const payload = o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  if (payload !== undefined) headers["content-type"] = "application/json";
  if (o.key !== null && method !== "GET") headers["idempotency-key"] = o.key ?? `p3r-${randomUUID()}`;
  const request = new NextRequest(new URL(o.path, ORIGIN), { method, headers, body: payload });
  const response = await sessionStore.run(sessionOrAnon(o.as), () => (handler as Handler)(request, { params: Promise.resolve(o.params ?? {}) }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

const lonLat = (count: number) =>
  Array.from({ length: count }, (_, i) => [Number((-100.3 + i * 0.00002).toFixed(6)), Number((25.67 + Math.sin(i / 50) * 0.001 + i * 0.00001).toFixed(6))]);
const lineString = (count: number) => ({ type: "LineString", coordinates: lonLat(count) });

describe("P3-R security hardening and route limits integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;

  beforeAll(async () => {
    admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
  }, 60_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  // ===========================================================================================
  // P3-F-10: saving and copying a real-size route
  // ===========================================================================================
  describe("route revision body limit (P3-F-10, P3-AC-07)", () => {
    let routeId: string;
    let draftId: string;
    let operator: TestStaff;

    beforeAll(async () => {
      operator = await createTestStaff("OPERATOR", "GLOBAL");
      authUserIds.push(operator.authUserId);
      const event = await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: "P3R Rutas", canonical_key: `p3r-routes-${randomUUID()}` }, null);
      const edition = await createEdition(
        admin.client,
        event.event_id,
        {
          slug: `p3r-rutas-${randomUUID().slice(0, 8)}`,
          name: "P3R Rutas",
          registration_mode: "FREE",
          city: "Monterrey",
          state_region: "NL",
          registration_close_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
        },
        null,
      );
      const modality = await createModality(admin.client, edition.edition_id, { key: "10k", name: "10K", official_distance_m: 10000 }, null);
      const route = await createRoute(admin.client, edition.edition_id, { name: "Ruta 10K real", modality_ids: [modality.modality_id] }, null);
      routeId = route.route_id;
      draftId = (await createManualRevision(admin.client, routeId, { geometry: { type: "LineString", coordinates: lonLat(5) } }, null)).route_revision_id;
    }, 60_000);

    test("a 10K-point geometry is above the old 64 KiB default and is saved by PATCH (draft) and POST (create / copy)", async () => {
      const geometry = lineString(10_000);
      const bytes = Buffer.byteLength(JSON.stringify({ geometry }));
      expect(bytes).toBeGreaterThan(64 * 1024);

      const patched = await call(revisionPatch, { method: "PATCH", path: `/api/v1/admin/route-revisions/${draftId}`, params: { revisionId: draftId }, body: { geometry }, as: operator.client });
      expect(patched.status).toBe(200);
      expect(patched.body.data.geometry.coordinates).toHaveLength(10_000);
      expect(patched.body.data.status).toBe("DRAFT");

      const created = await call(revisionsPost, { path: `/api/v1/admin/routes/${routeId}/revisions`, params: { routeId }, body: { geometry }, as: operator.client });
      expect(created.status).toBe(201);
      expect(created.body.data.geometry.coordinates).toHaveLength(10_000);
      expect(created.body.data.source).toBe("MANUAL");
      expect(Number(queryValue(`select st_npoints(geometry::geometry) from app.route_revision where route_revision_id = '${created.body.data.route_revision_id}'`))).toBe(10_000);
    });

    test("the cap is the import-gpx one (4.4 MB): a bigger body is a standard VALIDATION_ERROR body_too_large on both routes", async () => {
      const rawBody = JSON.stringify({ geometry: lineString(210_000) });
      expect(Buffer.byteLength(rawBody)).toBeGreaterThan(4_400_000);
      const patched = await call(revisionPatch, { method: "PATCH", path: `/api/v1/admin/route-revisions/${draftId}`, params: { revisionId: draftId }, rawBody, as: operator.client });
      expect(patched.status).toBe(400);
      expect(patched.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { location: "body", reason: "body_too_large" } });
      const created = await call(revisionsPost, { path: `/api/v1/admin/routes/${routeId}/revisions`, params: { routeId }, rawBody, as: operator.client });
      expect(created.status).toBe(400);
      expect(created.body.error.details.reason).toBe("body_too_large");
    }, 60_000);

    test("the point count is still validated server-side under the byte cap (200 001 tiny points, well below 4.4 MB)", async () => {
      const rawBody = JSON.stringify({ geometry: { type: "LineString", coordinates: Array.from({ length: 200_001 }, () => [1, 2]) } });
      expect(Buffer.byteLength(rawBody)).toBeLessThan(4_400_000);
      const patched = await call(revisionPatch, { method: "PATCH", path: `/api/v1/admin/route-revisions/${draftId}`, params: { revisionId: draftId }, rawBody, as: operator.client });
      expect(patched.status).toBe(400);
      expect(patched.body.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(patched.body.error.details)).toContain("geometry.coordinates");
    }, 60_000);

    test("authorization and the default limit elsewhere are unchanged", async () => {
      const checkin = await createTestStaff("CHECKIN", "GLOBAL");
      authUserIds.push(checkin.authUserId);
      const geometry = lineString(10);
      expect((await call(revisionPatch, { method: "PATCH", path: "/x", params: { revisionId: draftId }, body: { geometry }, as: checkin.client })).status).toBe(403);
      expect((await call(revisionPatch, { method: "PATCH", path: "/x", params: { revisionId: draftId }, body: { geometry }, as: null })).status).toBe(401);
      // The tasks refresh route still has the 64 KiB default.
      const big = await call(tasksRefreshPost, { path: "/api/v1/admin/tasks/refresh", rawBody: JSON.stringify({ edition_id: randomUUID(), pad: "x".repeat(70_000) }), as: operator.client });
      expect(big.status).toBe(400);
      expect(big.body.error.details.reason).toBe("body_too_large");
    });
  });

  // ===========================================================================================
  // P3SECA-03: actor rate limit on staff mutations
  // ===========================================================================================
  describe("staff mutation actor rate limit (P3SECA-03)", () => {
    test("failed attempts count, the 429 stops the call before the command, reads and race-day check-in are not throttled", async () => {
      const operator = await createTestStaff("OPERATOR", "GLOBAL");
      authUserIds.push(operator.authUserId);
      const original = queryValue("select max_hits::text from infra.rate_limit_policy where scope = 'admin.mutation'");
      expect(original).not.toBeNull();
      try {
        sql("update infra.rate_limit_policy set max_hits = 3 where scope = 'admin.mutation'");
        sql(`delete from infra.rate_limit_counter where scope = 'admin.mutation' and subject = '${operator.authUserId}'`);
        const refresh = (body: unknown) => call(tasksRefreshPost, { path: "/api/v1/admin/tasks/refresh", body, as: operator.client });

        // Three attempts that FAIL validation: they still count (the pre-check commits on its own, before the body is parsed).
        for (let i = 0; i < 3; i += 1) expect((await refresh({})).status).toBe(400);
        const limited = await refresh({ edition_id: randomUUID() });
        expect(limited.status).toBe(429);
        expect(limited.body.error.code).toBe("RATE_LIMITED");

        // Reads are not mutations.
        expect((await call(tasksGet, { method: "GET", path: "/api/v1/admin/tasks", as: operator.client })).status).toBe(200);
        // Race-day check-in keeps its own limits: the same exhausted actor can still scan.
        const scan = await call(checkInPost, {
          path: "/api/v1/check-in",
          // A syntactically valid pass payload that matches no pass (built at runtime; it is not a credential).
          body: { edition_id: queryValue("select edition_id::text from app.edition limit 1"), credential_token: `RN1.${randomBytes(32).toString("base64url")}` },
          key: null,
          as: operator.client,
        });
        expect(scan.status, JSON.stringify(scan.body)).toBe(200);
        expect(scan.body.data.outcome).toBe("UNKNOWN_PASS");
        // Another staff member has their own budget.
        const other = await createTestStaff("OPERATOR", "GLOBAL");
        authUserIds.push(other.authUserId);
        expect((await call(tasksRefreshPost, { path: "/api/v1/admin/tasks/refresh", body: {}, as: other.client })).status).toBe(400);
      } finally {
        sql(`update infra.rate_limit_policy set max_hits = ${original} where scope = 'admin.mutation'`);
        sql(`delete from infra.rate_limit_counter where scope = 'admin.mutation' and subject = '${operator.authUserId}'`);
      }
    }, 60_000);
  });

  // ===========================================================================================
  // P3SECA-09: tampered timestamp cursors
  // ===========================================================================================
  describe("timestamp cursors (P3SECA-09)", () => {
    test("a tampered timestamp is a 400 VALIDATION_ERROR (invalid_cursor), never a 500", async () => {
      const id = randomUUID();
      for (const detected_at of ["not-a-timestamp", "2026-13-45T99:99:99Z", "2026-10-04T12:00:00Z'; select 1;--"]) {
        const cursor = encodeCursor({ rank: 1, detected_at, id });
        const res = await call(tasksGet, { method: "GET", path: `/api/v1/admin/tasks?cursor=${cursor}`, as: admin.client });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { field: "cursor", reason: "invalid_cursor" } });
      }
      const editionId = randomUUID();
      const requestsCursor = encodeCursor({ created_at: "nope", id });
      const requests = await call(requestsGet, {
        method: "GET",
        path: `/api/v1/admin/editions/${editionId}/registration-requests?cursor=${requestsCursor}`,
        params: { editionId },
        as: admin.client,
      });
      expect(requests.status).toBe(400);
      expect(requests.body.error.details).toMatchObject({ field: "cursor", reason: "invalid_cursor" });
    });

    test("a genuine cursor still pages", async () => {
      const first = await call(tasksGet, { method: "GET", path: "/api/v1/admin/tasks?status=ALL&limit=1", as: admin.client });
      expect(first.status).toBe(200);
      const next = first.body.meta.next_cursor as string | null;
      if (next) expect((await call(tasksGet, { method: "GET", path: `/api/v1/admin/tasks?status=ALL&limit=1&cursor=${next}`, as: admin.client })).status).toBe(200);
    });
  });

  // ===========================================================================================
  // P3SECA-01 / -02: hold concentration without the account-age blind spot, and the waive wave
  // ===========================================================================================
  describe("hold concentration (P3SECA-01, P3SECA-02, P3-AC-13)", () => {
    let whatsapp: EditionFixture;
    let buyers: TestUser[];
    let original: Record<string, string | number | null>;
    const policyKeys = ["total_hold_share_percent", "total_hold_min_places", "modality_hold_share_percent", "modality_hold_min_places"] as const;

    const taskOf = async (editionId: string) => {
      const list = await call(tasksGet, { method: "GET", path: `/api/v1/admin/tasks?category=ANTI_HOARDING&status=ALL&edition_id=${editionId}`, as: admin.client });
      expect(list.status).toBe(200);
      return (list.body.data as any[]).find((t) => t.source_rule === "hold-concentration");
    };
    const request = (user: TestUser) =>
      call(createRequestPost, {
        path: "/api/v1/registration-requests",
        body: {
          edition_id: whatsapp.editionId,
          participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId, modality_id: whatsapp.modalityId }],
          legal_acceptances: [selfAcceptance(0, whatsapp.sportWaiverVersionId)],
        },
        as: user.client,
      });

    beforeAll(async () => {
      original = JSON.parse(queryValue(`select (to_jsonb(p) - 'settings_id')::text from private.anti_hoarding_policy p where p.settings_id = 1`) ?? "{}");
      whatsapp = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 12, priceAmountMinor: 20000 });
      // Established accounts only (backdated 3 days by createTestUser): the new-account trigger can never be the reason.
      buyers = await Promise.all([1, 2, 3].map((n) => createTestUser({ label: `p3r-hold-${n}` })));
      authUserIds.push(...buyers.map((b) => b.authUserId));
    }, 180_000);

    afterAll(() => {
      if (original.total_hold_share_percent !== undefined) {
        sql(`update private.anti_hoarding_policy set total_hold_share_percent = ${original.total_hold_share_percent}, total_hold_min_places = ${original.total_hold_min_places},
          modality_hold_share_percent = ${original.modality_hold_share_percent}, modality_hold_min_places = ${original.modality_hold_min_places} where settings_id = 1`);
      }
    });

    test("the policy route reads and writes the four new thresholds (defaults 50 / 20 / 70 / 10) and audits the change", async () => {
      const got = await call(policyGet, { method: "GET", path: "/api/v1/admin/anti-hoarding-policy", as: admin.client });
      expect(got.status).toBe(200);
      for (const key of policyKeys) expect(got.body.data).toHaveProperty(key);
      expect(Number(original.total_hold_share_percent)).toBe(50);
      expect(Number(original.total_hold_min_places)).toBe(20);
      expect(Number(original.modality_hold_share_percent)).toBe(70);
      expect(Number(original.modality_hold_min_places)).toBe(10);

      const patched = await call(policyPatch, {
        method: "PATCH",
        path: "/api/v1/admin/anti-hoarding-policy",
        body: { total_hold_share_percent: 25, total_hold_min_places: 3 },
        as: admin.client,
      });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({ total_hold_share_percent: 25, total_hold_min_places: 3, modality_hold_share_percent: 70 });
      expect((await call(policyPatch, { method: "PATCH", path: "/x", body: { total_hold_share_percent: 0 }, as: admin.client })).status).toBe(400);
    });

    test("three ESTABLISHED accounts holding one place each (3 of 12 = 25%) raise the alert; nothing is canceled; a waive silences that wave only", async () => {
      for (const buyer of buyers) {
        sql("delete from infra.rate_limit_counter where scope like 'registration_request.create%'");
        const res = await request(buyer);
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe("PENDING_CONFIRMATION");
      }
      const task = await taskOf(whatsapp.editionId);
      expect(task).toMatchObject({ status: "OPEN", blocking_level: "ACTION_REQUIRED", category: "ANTI_HOARDING", edition_id: whatsapp.editionId });
      expect(task.metadata.triggers).toEqual(["TOTAL_HOLD_SHARE"]);
      expect(task.metadata).toMatchObject({ pending_places: 3, capacity: 12 });
      expect(Number(queryValue(`select count(*) from app.registration_request where edition_id = '${whatsapp.editionId}' and status = 'PENDING_CONFIRMATION'`))).toBe(3);

      const waived = await call(taskWaivePost, { path: `/api/v1/admin/tasks/${task.admin_task_id}/waive`, params: { id: task.admin_task_id }, body: { reason: "Evento popular" }, as: admin.client });
      expect(waived.status).toBe(200);
      expect(waived.body.data.status).toBe("WAIVED");

      // The sweep while the condition still holds leaves it waived.
      const refresh = () => call(tasksRefreshPost, { path: "/api/v1/admin/tasks/refresh", body: { edition_id: whatsapp.editionId }, as: admin.client });
      expect((await refresh()).status).toBe(200);
      expect((await taskOf(whatsapp.editionId)).status).toBe("WAIVED");

      // The buyers withdraw: the condition clears (the waived task is only marked inactive).
      for (const buyer of buyers) {
        const pending = queryValue(`select registration_request_id::text from app.registration_request where buyer_profile_id = '${buyer.runnerProfileId}' and status = 'PENDING_CONFIRMATION'`);
        const { error } = await buyer.client.rpc("cancel_registration_request", { p_registration_request_id: pending, p_reason: null, p_idempotency_key: null });
        expect(error).toBeNull();
      }
      expect((await refresh()).status).toBe(200);
      expect((await taskOf(whatsapp.editionId)).status).toBe("WAIVED");

      // The concentration comes back: the SAME task re-opens (a new wave is not silenced by the old waive).
      for (const buyer of buyers) {
        sql("delete from infra.rate_limit_counter where scope like 'registration_request.create%'");
        expect((await request(buyer)).status).toBe(201);
      }
      const reopened = await taskOf(whatsapp.editionId);
      expect(reopened.admin_task_id).toBe(task.admin_task_id);
      expect(reopened.status).toBe("OPEN");
      expect(reopened.metadata.reopened_after_waive).toMatchObject({ waive_reason: "Evento popular" });
      expect(Number(queryValue(`select count(*) from app.admin_task where task_key = 'hold-concentration:${whatsapp.editionId}'`))).toBe(1);
      expect(Number(queryValue(`select count(*) from app.registration_request where edition_id = '${whatsapp.editionId}' and status = 'PENDING_CONFIRMATION'`))).toBe(3);
    }, 180_000);
  });

  // ===========================================================================================
  // P3SECA-05 and P3SECA-06 over the cancel and close routes
  // ===========================================================================================
  describe("closure authority and the OWN-04 notification outcome (P3SECA-05, P3SECA-06, P3-AC-03/14)", () => {
    let edition: ClosureEdition;
    let closing: ClosureEdition;
    let operator: TestStaff;
    let editionAdmin: TestStaff;
    let originalEpoch: { epoch: string | null; frozenAt: string | null };

    beforeAll(async () => {
      operator = await createTestStaff("OPERATOR", "GLOBAL");
      authUserIds.push(operator.authUserId);
      edition = await buildClosureEdition(admin.client, authUserIds, { runners: 2, label: "p3r-cancel" });
      closing = await buildClosureEdition(admin.client, authUserIds, { runners: 1, label: "p3r-close" });
      editionAdmin = await createTestStaff("ADMIN", "EDITION", closing.editionId);
      authUserIds.push(editionAdmin.authUserId);
      finishEdition(closing.editionId);
      originalEpoch = {
        epoch: queryValue("select ranking_epoch::text from app.competition_settings where settings_id = 1"),
        frozenAt: queryValue("select ranking_epoch_frozen_at::text from app.competition_settings where settings_id = 1"),
      };
    }, 240_000);

    afterAll(() => {
      const epoch = originalEpoch.epoch ? `'${originalEpoch.epoch}'` : "null";
      const frozenAt = originalEpoch.frozenAt ? `'${originalEpoch.frozenAt}'` : "null";
      sql(`update app.competition_settings set ranking_epoch = ${epoch}, ranking_epoch_frozen_at = ${frozenAt} where settings_id = 1`);
    });

    test("cancel response carries the notification outcome: queued for a participant with an email, no follow-up task", async () => {
      const registrationId = edition.runners[0].registrationId;
      const res = await call(cancelRegistrationPost, {
        path: `/api/v1/admin/registrations/${registrationId}/cancel`,
        params: { id: registrationId },
        body: { reason: "Solicitud del participante", reason_category: "PARTICIPANT_REQUEST" },
        as: operator.client,
      });
      expect(res.status).toBe(200);
      // Existing keys unchanged, one additive key.
      expect(res.body.data).toMatchObject({ registration_id: registrationId, status: "CANCELED", cancel_reason: "Solicitud del participante" });
      expect(res.body.data.notification).toEqual({ status: "queued", follow_up_task_id: null });
      expect(Number(queryValue(`select count(*) from app.admin_task where task_key = 'registration-cancel-notice:${registrationId}'`))).toBe(0);
    });

    test("no_contact: the response says so and an ACTION_REQUIRED task is open for staff follow-up (idempotent on replay)", async () => {
      const registrationId = edition.runners[1].registrationId;
      sql(`update auth.users set email = null where id = '${edition.runners[1].user.authUserId}'`);
      const key = `p3r-cancel-${randomUUID()}`;
      const send = () =>
        call(cancelRegistrationPost, {
          path: `/api/v1/admin/registrations/${registrationId}/cancel`,
          params: { id: registrationId },
          body: { reason: "Solicitud del participante", reason_category: "PARTICIPANT_REQUEST" },
          key,
          as: operator.client,
        });
      const first = await send();
      expect(first.status).toBe(200);
      expect(first.body.data.notification.status).toBe("no_contact");
      const taskId = first.body.data.notification.follow_up_task_id as string;
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/);

      const task = await call(taskGet, { method: "GET", path: `/api/v1/admin/tasks/${taskId}`, params: { id: taskId }, as: operator.client });
      expect(task.status).toBe(200);
      expect(task.body.data).toMatchObject({
        status: "OPEN",
        blocking_level: "ACTION_REQUIRED",
        category: "COMMUNICATIONS",
        source_rule: "registration-cancel-notice",
        edition_id: edition.editionId,
        related_entity_type: "registration",
        related_entity_id: registrationId,
      });
      expect(JSON.stringify(task.body.data)).not.toMatch(/example\.test|Solicitud/);

      // An Idempotency-Key replay returns the stored cancellation, still reports the outcome and creates no second task.
      const replay = await send();
      expect(replay.status).toBe(200);
      expect(replay.body.data.notification).toEqual({ status: "no_contact", follow_up_task_id: taskId });
      expect(Number(queryValue(`select count(*) from app.admin_task where source_rule = 'registration-cancel-notice' and edition_id = '${edition.editionId}'`))).toBe(1);
    });

    test("an ADMIN scoped to the Edition cannot close or reopen it; the global ADMIN can, and the ranking-epoch freeze is audited once", async () => {
      sql("update app.competition_settings set ranking_epoch = null, ranking_epoch_frozen_at = null where settings_id = 1");
      const registrationId = closing.runners[0].registrationId;
      const editionId = closing.editionId;
      const resolved = await call(resolveAttendancePost, {
        path: `/api/v1/admin/registrations/${registrationId}/attendance/resolve`,
        params: { id: registrationId },
        body: { status: "PRESENT", reason: "Llegó", evidence_metadata: { method: "MANUAL_DESK" } },
        as: operator.client,
      });
      expect(resolved.status).toBe(200);
      const finalized = await call(finalizePost, { path: `/api/v1/admin/editions/${editionId}/attendance/finalize`, params: { editionId }, body: {}, as: operator.client });
      expect(finalized.status).toBe(200);

      const closePath = `/api/v1/admin/editions/${editionId}/close`;
      const refused = await call(closePost, { path: closePath, params: { editionId }, body: {}, as: editionAdmin.client });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("FORBIDDEN");
      expect(queryValue(`select closure_state from app.edition where edition_id = '${editionId}'`)).toBe("PENDING");
      expect(queryValue("select ranking_epoch::text from app.competition_settings where settings_id = 1")).toBeNull();

      const closed = await call(closePost, { path: closePath, params: { editionId }, body: {}, as: admin.client });
      expect(closed.status).toBe(200);
      expect(queryValue("select ranking_epoch is not null from app.competition_settings where settings_id = 1")).toBe("t");
      const audit = () => Number(queryValue(`select count(*) from audit.audit_log where action = 'RANKING_EPOCH_FROZEN' and edition_id = '${editionId}'`));
      expect(audit()).toBe(1);

      const reopenPath = `/api/v1/admin/editions/${editionId}/reopen`;
      expect((await call(reopenPost, { path: reopenPath, params: { editionId }, body: { reason: "Corrección" }, as: editionAdmin.client })).status).toBe(403);
      expect((await call(reopenPost, { path: reopenPath, params: { editionId }, body: { reason: "Corrección" }, as: admin.client })).status).toBe(200);
      expect((await call(closePost, { path: closePath, params: { editionId }, body: {}, as: admin.client })).status).toBe(200);
      expect(audit()).toBe(1);
    }, 120_000);
  });

  // ===========================================================================================
  // P3SECA-04: the attendance workspace read does not queue behind an Edition lock when there is nothing to reconcile
  // ===========================================================================================
  describe("attendance workspace lock (P3SECA-04)", () => {
    // A second database session holds the Edition row lock for ~6 s (like a long create/closure command would). The script goes through stdin
    // (a `-c` string would be split by the Windows shell); the sleep length is unique per call so the session can be recognised in pg_stat_activity.
    async function holdEditionLock(editionId: string, seconds = 6): Promise<{ done: Promise<void> }> {
      const sleep = `${seconds}.${Math.floor(100 + Math.random() * 899)}`;
      const child = spawn("docker", ["exec", "-i", "supabase_db_RUNIIIS_WEB", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
        stdio: ["pipe", "ignore", "ignore"],
        shell: process.platform === "win32",
      });
      child.stdin.end(`begin;
select 1 from app.edition where edition_id = '${editionId}' for update;
select pg_sleep(${sleep});
commit;
`);
      const done = new Promise<void>((resolve) => child.on("close", () => resolve()));
      for (let i = 0; i < 40; i += 1) {
        if (queryValue(`select count(*) from pg_stat_activity where query like 'select pg_sleep(${sleep})%' and state = 'active'`) === "1") return { done };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await done;
      throw new Error("lock holder did not start");
    }

    test("a reconciled Edition is read while another session holds its lock; an unreconciled one waits for it", async () => {
      const operator = await createTestStaff("OPERATOR", "GLOBAL");
      authUserIds.push(operator.authUserId);
      const reconciled = await buildClosureEdition(admin.client, authUserIds, { runners: 1, label: "p3r-lock-a" });
      const unreconciled = await buildClosureEdition(admin.client, authUserIds, { runners: 1, label: "p3r-lock-b" });
      finishEdition(reconciled.editionId);
      finishEdition(unreconciled.editionId);
      const read = (editionId: string) => call(workspaceGet, { method: "GET", path: `/api/v1/admin/editions/${editionId}/attendance`, params: { editionId }, as: operator.client });

      // First read reconciles the Edition (it writes the starting rows under the lock).
      expect((await read(reconciled.editionId)).status).toBe(200);

      const holder = await holdEditionLock(reconciled.editionId);
      const startedFast = Date.now();
      const fast = await read(reconciled.editionId);
      const fastMs = Date.now() - startedFast;
      expect(fast.status).toBe(200);
      expect(fast.body.data.universe_count).toBe(1);
      expect(fastMs).toBeLessThan(3_000);
      await holder.done;

      const holder2 = await holdEditionLock(unreconciled.editionId);
      const startedSlow = Date.now();
      const slow = await read(unreconciled.editionId);
      const slowMs = Date.now() - startedSlow;
      expect(slow.status).toBe(200);
      expect(slowMs).toBeGreaterThan(2_500);
      await holder2.done;
      // And it reconciled while it had the lock.
      expect(slow.body.data.attendance_counts).toBeDefined();
    }, 120_000);
  });
});
