import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createEdition, createEvent } from "@/lib/server/domain/events/service";
import { cleanup, createTestStaff, queryValue, sql, type TestStaff } from "../helpers";
import { sessionOrAnon, sessionStore } from "../closure/harness";

// P3-L admin API gaps over the real route modules (defineRoute: same-origin guard, auth, zod, Idempotency-Key, envelope, error mapping)
// with real staff sessions against the local Postgres: Events catalogue + Event read (P3-AC-06), optimistic concurrency on Edition edits
// and transitions incl. a real two-session race (P3-AC-15), and the anti-hoarding policy route (P3-AC-13). The existing
// GET /api/v1/admin/events (an Editions list) is asserted unchanged.

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon: orAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? orAnon(null) };
});

import { GET as editionsListGet } from "@/app/api/v1/admin/events/route";
import { GET as eventsCatalogGet } from "@/app/api/v1/admin/events/list/route";
import { GET as eventGet } from "@/app/api/v1/admin/events/[eventId]/route";
import { GET as editorGet, PATCH as editionPatch } from "@/app/api/v1/admin/editions/[editionId]/route";
import { POST as cancelPost } from "@/app/api/v1/admin/editions/[editionId]/cancel/route";
import { POST as schedulePost } from "@/app/api/v1/admin/editions/[editionId]/schedule/route";
import { GET as policyGet, PATCH as policyPatch } from "@/app/api/v1/admin/anti-hoarding-policy/route";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;
type Res = { status: number; body: any; headers: Headers };
const asHandler = (route: unknown) => route as Handler;
const ORIGIN = process.env.APP_BASE_URL ?? "http://127.0.0.1:3100";

async function call(
  handler: unknown,
  o: { method?: "GET" | "POST" | "PATCH"; path: string; params?: Record<string, string>; body?: unknown; key?: string | null; as: SupabaseClient | null },
): Promise<Res> {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.key) headers["idempotency-key"] = o.key;
  const request = new NextRequest(new URL(o.path, ORIGIN), { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const response = await sessionStore.run(sessionOrAnon(o.as), () => asHandler(handler)(request, { params: Promise.resolve(o.params ?? {}) }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

describe("admin API gaps (P3-L) integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let operator: TestStaff;
  let checkin: TestStaff;
  const unique = randomUUID().slice(0, 8);
  let emptyEventId: string;
  let eventId: string;
  let editionId: string;
  let secondEditionId: string;
  let originalPolicy: Record<string, string | number | null>;

  const newEdition = (slugSuffix: string) =>
    createEdition(
      admin.client,
      eventId,
      {
        slug: `p3l-${unique}-${slugSuffix}`,
        name: `P3L ${slugSuffix}`,
        registration_mode: "FREE",
        city: "Monterrey",
        state_region: "NL",
        schedule: { local_date: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10), local_start_time: "07:00:00" },
      },
      null,
    );
  const editor = (id: string, as: TestStaff | null = admin) => call(editorGet, { path: `/api/v1/admin/editions/${id}`, params: { editionId: id }, as: as?.client ?? null });
  const token = async (id: string) => (await editor(id)).body.data.edition.updated_at as string;
  const patch = (id: string, body: unknown, as: TestStaff | null = admin) =>
    call(editionPatch, { method: "PATCH", path: `/api/v1/admin/editions/${id}`, params: { editionId: id }, body, as: as?.client ?? null });

  beforeAll(async () => {
    [admin, operator, checkin] = await Promise.all([createTestStaff("ADMIN", "GLOBAL"), createTestStaff("OPERATOR", "GLOBAL"), createTestStaff("CHECKIN", "GLOBAL")]);
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId);
    emptyEventId = (await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: `P3L Vacio ${unique}`, canonical_key: `p3l-vacio-${unique}` }, null)).event_id;
    eventId = (await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: `P3L Evento ${unique}`, canonical_key: `p3l-evento-${unique}` }, null)).event_id;
    editionId = (await newEdition("a")).edition_id;
    secondEditionId = (await newEdition("b")).edition_id;
    originalPolicy = JSON.parse(queryValue(`select (to_jsonb(p) - 'settings_id')::text from private.anti_hoarding_policy p where p.settings_id = 1`) ?? "{}");
  }, 60_000);

  afterAll(async () => {
    // The policy is a global singleton other suites depend on: put the original values back.
    if (originalPolicy?.captcha_new_account_hours !== undefined) {
      sql(`update private.anti_hoarding_policy set
        captcha_new_account_hours = ${originalPolicy.captcha_new_account_hours},
        large_hold_min_places = ${originalPolicy.large_hold_min_places},
        new_account_hold_share_percent = ${originalPolicy.new_account_hold_share_percent},
        new_account_hold_min_places = ${originalPolicy.new_account_hold_min_places},
        single_buyer_hold_places = ${originalPolicy.single_buyer_hold_places}
        where settings_id = 1`);
    }
    await cleanup(authUserIds);
  });

  test("GET /admin/events is still the Editions list (backwards compatible)", async () => {
    const res = await call(editionsListGet, { path: `/api/v1/admin/events?search=${unique}`, as: admin.client });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0]).toHaveProperty("edition_id");
    expect(res.body.data[0]).toHaveProperty("event_name");
    expect(res.body.data[0]).not.toHaveProperty("canonical_key");
    expect(res.body.meta).toHaveProperty("next_cursor");
  });

  test("Events catalogue lists Events without Editions with type, key, status and edition count; paginates; scopes by role", async () => {
    const list = await call(eventsCatalogGet, { path: `/api/v1/admin/events/list?search=${unique}&limit=100`, as: admin.client });
    expect(list.status).toBe(200);
    const mine = list.body.data as any[];
    expect(mine).toHaveLength(2);
    const empty = mine.find((e) => e.event_id === emptyEventId);
    expect(empty).toMatchObject({ event_type_key: "ROAD_RACE", status: "ACTIVE", edition_count: 0, latest_edition_created_at: null, name: `P3L Vacio ${unique}` });
    expect(mine.find((e) => e.event_id === eventId)).toMatchObject({ edition_count: 2 });

    const first = await call(eventsCatalogGet, { path: `/api/v1/admin/events/list?search=${unique}&limit=1`, as: admin.client });
    expect(first.body.data).toHaveLength(1);
    expect(typeof first.body.meta.next_cursor).toBe("string");
    const second = await call(eventsCatalogGet, { path: `/api/v1/admin/events/list?search=${unique}&limit=1&cursor=${first.body.meta.next_cursor}`, as: admin.client });
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].event_id).not.toBe(first.body.data[0].event_id);
    expect(second.body.meta.next_cursor).toBeNull();

    expect((await call(eventsCatalogGet, { path: `/api/v1/admin/events/list?search=${unique}`, as: operator.client })).body.data).toHaveLength(2);
    expect((await call(eventsCatalogGet, { path: `/api/v1/admin/events/list?search=${unique}`, as: checkin.client })).body.data).toEqual([]);
    expect((await call(eventsCatalogGet, { path: "/api/v1/admin/events/list", as: null })).status).toBe(401);
    expect((await call(eventsCatalogGet, { path: "/api/v1/admin/events/list?status=DELETED", as: admin.client })).status).toBe(400);
    expect((await call(eventsCatalogGet, { path: "/api/v1/admin/events/list?publication_state=DRAFT", as: admin.client })).status).toBe(400);
  });

  test("Event read projection: type, key, status and Edition summary with versions; RBAC and not-found", async () => {
    const res = await call(eventGet, { path: `/api/v1/admin/events/${eventId}`, params: { eventId }, as: admin.client });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ event_id: eventId, canonical_key: `p3l-evento-${unique}`, event_type_key: "ROAD_RACE", status: "ACTIVE", edition_count: 2 });
    expect(res.body.data.editions.map((e: any) => e.edition_id).sort()).toEqual([editionId, secondEditionId].sort());
    expect(res.body.data.editions[0].updated_at).toBeTruthy();

    const none = await call(eventGet, { path: `/api/v1/admin/events/${emptyEventId}`, params: { eventId: emptyEventId }, as: operator.client });
    expect(none.body.data.editions).toEqual([]);
    const unknown = randomUUID();
    expect((await call(eventGet, { path: `/api/v1/admin/events/${unknown}`, params: { eventId: unknown }, as: admin.client })).status).toBe(404);
    expect((await call(eventGet, { path: `/api/v1/admin/events/${eventId}`, params: { eventId }, as: checkin.client })).status).toBe(403);
    expect((await call(eventGet, { path: `/api/v1/admin/events/${eventId}`, params: { eventId }, as: null })).status).toBe(401);
  });

  test("Edition PATCH: no token = last write wins; fresh token ok; stale token = 409 STALE_STATE with no change", async () => {
    const t0 = await token(editionId);
    const noToken = await patch(editionId, { name: "Sin token" });
    expect(noToken.status).toBe(200);
    expect(noToken.body.data.name).toBe("Sin token");

    const stale = await patch(editionId, { name: "Con token viejo", expected_updated_at: t0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("CONFLICT");
    expect(stale.body.error.details).toMatchObject({ reason: "STALE_STATE", field: "expected_updated_at" });
    expect(stale.body.error.details.current_updated_at).toBeTruthy();
    expect((await editor(editionId)).body.data.edition.name).toBe("Sin token");

    const t1 = await token(editionId);
    const fresh = await patch(editionId, { name: "Con token nuevo", expected_updated_at: t1 });
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.name).toBe("Con token nuevo");
    expect(fresh.body.data.updated_at).not.toBe(t1);

    expect((await patch(editionId, { name: "x", expected_updated_at: "ayer" })).status).toBe(400);
    expect((await patch(editionId, { name: "x", expected_updated_at: t1 }, checkin)).status).toBe(403);
    expect((await patch(editionId, { registration_close_at: "2030-01-01T00:00:00Z", expected_updated_at: "2020-01-01T00:00:00Z" }, operator)).status).toBe(403);
  });

  test("two sessions racing on the same token: exactly one wins, the other is told STALE_STATE", async () => {
    const t = await token(editionId);
    const [a, b] = await Promise.all([
      patch(editionId, { name: "Carrera A", expected_updated_at: t }, admin),
      patch(editionId, { name: "Carrera B", expected_updated_at: t }, operator),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    const winner = a.status === 200 ? a : b;
    expect(loser.body.error.details.reason).toBe("STALE_STATE");
    expect((await editor(editionId)).body.data.edition.name).toBe(winner.body.data.name);
  });

  test("schedule and a status transition are guarded; an idempotent replay with the old token is not stale", async () => {
    const t0 = await token(secondEditionId);
    await patch(secondEditionId, { name: "Mueve la version" });
    const date = new Date(Date.now() + 91 * 86_400_000).toISOString().slice(0, 10);
    const staleSchedule = await call(schedulePost, {
      method: "POST",
      path: `/api/v1/admin/editions/${secondEditionId}/schedule`,
      params: { editionId: secondEditionId },
      body: { local_date: date, expected_updated_at: t0 },
      as: admin.client,
    });
    expect(staleSchedule.status).toBe(409);
    expect(staleSchedule.body.error.details.reason).toBe("STALE_STATE");

    const cancel = (body: unknown, key: string, as: TestStaff = admin) =>
      call(cancelPost, { method: "POST", path: `/api/v1/admin/editions/${secondEditionId}/cancel`, params: { editionId: secondEditionId }, body, key, as: as.client });
    const staleCancel = await cancel({ reason: "prueba", expected_updated_at: t0 }, `p3l-${randomUUID()}`);
    expect(staleCancel.status).toBe(409);
    expect(staleCancel.body.error.details.reason).toBe("STALE_STATE");
    expect((await editor(secondEditionId)).body.data.edition.execution_state).toBe("SCHEDULED");

    const t1 = await token(secondEditionId);
    const key = `p3l-cancel-${randomUUID()}`;
    const done = await cancel({ reason: "prueba", expected_updated_at: t1 }, key);
    expect(done.status).toBe(200);
    expect(done.body.data.edition.execution_state).toBe("CANCELED");
    const replay = await cancel({ reason: "prueba", expected_updated_at: t1 }, key);
    expect(replay.status).toBe(200);
    expect(replay.body.data.edition.execution_state).toBe("CANCELED");
    const otherKey = await cancel({ reason: "prueba", expected_updated_at: t1 }, `p3l-${randomUUID()}`);
    expect(otherKey.status).toBe(409);
    expect(otherKey.body.error.details.reason).toBe("STALE_STATE");
    expect((await cancel({ reason: "x" }, `p3l-${randomUUID()}`, operator)).status).toBe(403);
  });

  test("anti-hoarding policy route: ADMIN only, validated, Idempotency-Key required, audited once, replay-safe", async () => {
    const path = "/api/v1/admin/anti-hoarding-policy";
    expect((await call(policyGet, { path, as: null })).status).toBe(401);
    expect((await call(policyGet, { path, as: operator.client })).status).toBe(403);
    expect((await call(policyGet, { path, as: checkin.client })).status).toBe(403);
    const read = await call(policyGet, { path, as: admin.client });
    expect(read.status).toBe(200);
    expect(read.body.data).toEqual(
      expect.objectContaining({ captcha_new_account_hours: expect.any(Number), large_hold_min_places: expect.any(Number), updated_at: expect.any(String) }),
    );
    expect(read.headers.get("cache-control")).toBe("private, no-store");

    const patchPolicy = (body: unknown, key: string | null, as: TestStaff | null = admin) =>
      call(policyPatch, { method: "PATCH", path, body, key, as: as?.client ?? null });
    const hours = read.body.data.captcha_new_account_hours === 30 ? 36 : 30;
    expect((await patchPolicy({ captcha_new_account_hours: hours }, null)).body.error.details).toMatchObject({ header: "Idempotency-Key", reason: "missing" });
    expect((await patchPolicy({ captcha_new_account_hours: hours }, `p3l-${randomUUID()}`, operator)).status).toBe(403);
    expect((await patchPolicy({}, `p3l-${randomUUID()}`)).status).toBe(400);
    expect((await patchPolicy({ captcha_new_account_hours: 0 }, `p3l-${randomUUID()}`)).status).toBe(400);
    expect((await patchPolicy({ nope: 1 }, `p3l-${randomUUID()}`)).status).toBe(400);

    const auditCount = () => Number(queryValue(`select count(*) from audit.audit_log where action = 'ANTI_HOARDING_POLICY_UPDATED'`));
    const before = auditCount();
    const key = `p3l-policy-${randomUUID()}`;
    const updated = await patchPolicy({ captcha_new_account_hours: hours }, key);
    expect(updated.status).toBe(200);
    expect(updated.body.data.captcha_new_account_hours).toBe(hours);
    expect(auditCount()).toBe(before + 1);
    const replay = await patchPolicy({ captcha_new_account_hours: hours }, key);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(updated.body.data);
    expect(auditCount()).toBe(before + 1);
    expect((await patchPolicy({ captcha_new_account_hours: hours + 1 }, key)).body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await call(policyGet, { path, as: admin.client })).body.data.captcha_new_account_hours).toBe(hours);
  });
});
