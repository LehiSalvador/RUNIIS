import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createEdition, createEditionLocation, createEvent, createModality, createScheduleItem } from "@/lib/server/domain/events/service";
import { cleanup, createTestStaff, queryValue, type TestStaff } from "../helpers";
import { sessionOrAnon, sessionStore } from "../closure/harness";

// P3-M Edition configuration API gaps over the real route modules (defineRoute: same-origin guard, auth, zod, Idempotency-Key, envelope, error
// mapping) with real staff sessions against the local Postgres: schedule revision history, media references (no upload), nullable PATCH on
// locations and agenda items (P3-AC-06), and the Edition version moving on a schedule edit so a stale time-only edit is refused, including
// a real two-session race (P3-AC-15).

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon: orAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? orAnon(null) };
});

import { GET as editorGet } from "@/app/api/v1/admin/editions/[editionId]/route";
import { POST as schedulePost } from "@/app/api/v1/admin/editions/[editionId]/schedule/route";
import { GET as revisionsGet } from "@/app/api/v1/admin/editions/[editionId]/schedule-revisions/route";
import { GET as mediaGet, POST as mediaPost } from "@/app/api/v1/admin/editions/[editionId]/media-assets/route";
import { POST as contentBlockPost } from "@/app/api/v1/admin/editions/[editionId]/content-blocks/route";
import { PATCH as locationPatch } from "@/app/api/v1/admin/locations/[locationId]/route";
import { PATCH as agendaPatch } from "@/app/api/v1/admin/agenda/[itemId]/route";

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

describe("edition configuration API gaps (P3-M) integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let operator: TestStaff;
  let scopedOperator: TestStaff;
  let checkin: TestStaff;
  const unique = randomUUID().slice(0, 8);
  let eventId: string;
  let editionId: string;
  let otherEditionId: string;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  const newEdition = (suffix: string, schedule: Record<string, string> = { local_date: day(90), local_start_time: "07:00:00" }) =>
    createEdition(
      admin.client,
      eventId,
      { slug: `p3m-${unique}-${suffix}`, name: `P3M ${suffix}`, registration_mode: "FREE", city: "Monterrey", state_region: "NL", schedule },
      null,
    );
  const token = async (id: string) =>
    (await call(editorGet, { path: `/api/v1/admin/editions/${id}`, params: { editionId: id }, as: admin.client })).body.data.edition.updated_at as string;
  const schedule = (id: string, body: Record<string, unknown>, as: TestStaff = admin) =>
    call(schedulePost, { method: "POST", path: `/api/v1/admin/editions/${id}/schedule`, params: { editionId: id }, body, as: as.client });
  const revisions = (id: string, query = "", as: TestStaff | null = admin) =>
    call(revisionsGet, { path: `/api/v1/admin/editions/${id}/schedule-revisions${query}`, params: { editionId: id }, as: as?.client ?? null });
  const media = (id: string, query = "", as: TestStaff | null = admin) =>
    call(mediaGet, { path: `/api/v1/admin/editions/${id}/media-assets${query}`, params: { editionId: id }, as: as?.client ?? null });
  const createMedia = (id: string, body: Record<string, unknown>, key: string | null, as: TestStaff | null = admin) =>
    call(mediaPost, { method: "POST", path: `/api/v1/admin/editions/${id}/media-assets`, params: { editionId: id }, body, key, as: as?.client ?? null });

  beforeAll(async () => {
    [admin, operator, checkin] = await Promise.all([createTestStaff("ADMIN", "GLOBAL"), createTestStaff("OPERATOR", "GLOBAL"), createTestStaff("CHECKIN", "GLOBAL")]);
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId);
    eventId = (await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: `P3M Evento ${unique}`, canonical_key: `p3m-evento-${unique}` }, null)).event_id;
    editionId = (await newEdition("a")).edition_id;
    otherEditionId = (await newEdition("b")).edition_id;
    scopedOperator = await createTestStaff("OPERATOR", "EDITION", otherEditionId);
    authUserIds.push(scopedOperator.authUserId);
  }, 60_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  test("a time-only schedule edit moves the Edition version: the pre-edit token is stale, a real two-session race has one winner", async () => {
    const t0 = await token(editionId);
    const first = await schedule(editionId, { local_date: day(90), local_start_time: "07:30:00", reason: "Ajuste de hora", expected_updated_at: t0 });
    expect(first.status).toBe(200);
    expect(first.body.data.changed).toBe(true);
    expect(first.body.data.edition.updated_at).not.toBe(t0);
    expect(await token(editionId)).toBe(first.body.data.edition.updated_at);

    const stale = await schedule(editionId, { local_date: day(90), local_start_time: "08:00:00", expected_updated_at: t0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toMatchObject({ reason: "STALE_STATE", field: "expected_updated_at" });

    const t1 = await token(editionId);
    const [a, b] = await Promise.all([
      schedule(editionId, { local_date: day(90), local_start_time: "08:00:00", reason: "Carrera A", expected_updated_at: t1 }, admin),
      schedule(editionId, { local_date: day(90), local_start_time: "08:30:00", reason: "Carrera B", expected_updated_at: t1 }, operator),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.details.reason).toBe("STALE_STATE");

    // A no-op (same date and times) is not a revision and does not move the version.
    const t2 = await token(editionId);
    const noop = await schedule(editionId, { ...(a.status === 200 ? { local_start_time: "08:00:00" } : { local_start_time: "08:30:00" }), local_date: day(90), expected_updated_at: t2 });
    expect(noop.status).toBe(200);
    expect(noop.body.data.changed).toBe(false);
    expect(await token(editionId)).toBe(t2);
  }, 60_000);

  test("schedule revision history: newest first, current flagged, reason/times/actor, keyset pagination, RBAC", async () => {
    const all = await revisions(editionId);
    expect(all.status).toBe(200);
    const items = all.body.data as any[];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(all.body.meta.total).toBe(items.length);
    expect(all.body.meta.next_cursor).toBeNull();
    expect(items.map((r) => r.revision)).toEqual([...items.map((r) => r.revision)].sort((x, y) => y - x));
    expect(items.filter((r) => r.is_current)).toHaveLength(1);
    expect(items[0].is_current).toBe(true);
    expect(items.at(-1)).toMatchObject({ revision: 1, schedule_state: "DATE_TIME_CONFIRMED", local_start_time: "07:00:00", timezone: "America/Monterrey" });
    expect(items.find((r) => r.reason === "Ajuste de hora")).toMatchObject({ local_start_time: "07:30:00", is_current: false });
    expect(items[0].created_by_staff_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(items[0]).sort()).toEqual(
      ["created_at", "created_by_staff_id", "edition_schedule_revision_id", "effective_end_at", "effective_start_at", "is_current", "local_date", "local_end_time",
        "local_start_time", "reason", "revision", "schedule_state", "superseded_at", "timezone"].sort(),
    );

    const page1 = await revisions(editionId, "?limit=2");
    expect(page1.body.data).toHaveLength(2);
    expect(typeof page1.body.meta.next_cursor).toBe("string");
    const page2 = await revisions(editionId, `?limit=2&cursor=${page1.body.meta.next_cursor}`);
    expect(page2.body.data[0].revision).toBe(items[2].revision);
    expect(page2.body.data.map((r: any) => r.revision)).not.toContain(page1.body.data[0].revision);

    expect((await revisions(editionId, "", operator)).status).toBe(200);
    expect((await revisions(editionId, "", checkin)).status).toBe(403);
    expect((await revisions(editionId, "", scopedOperator)).status).toBe(403);
    expect((await revisions(otherEditionId, "", scopedOperator)).status).toBe(200);
    expect((await revisions(editionId, "", null)).status).toBe(401);
    expect((await revisions(editionId, "?limit=0")).status).toBe(400);
    expect((await revisions(editionId, "?status=x")).status).toBe(400);
    const unknown = randomUUID();
    expect((await revisions(unknown)).status).toBe(404);
  });

  test("media references: validated key, Idempotency-Key required, replay without a duplicate, audit, list/filter/paginate, RBAC", async () => {
    const body = { media_type: "IMAGE", storage_object_key: `runiis/p3m/${unique}/salida`, alt_text: "Linea de salida", focal_point: { x: 0.3, y: 0.6 } };
    expect((await createMedia(editionId, body, null)).status).toBe(400);
    expect((await createMedia(editionId, { ...body, storage_object_key: "https://res.cloudinary.com/demo/image/upload/a.png" }, `p3m-${unique}-url`)).status).toBe(400);
    expect((await createMedia(editionId, { ...body, storage_object_key: "a/../b" }, `p3m-${unique}-dots`)).status).toBe(400);
    expect((await createMedia(editionId, { ...body, media_type: "VIDEO" }, `p3m-${unique}-video`)).status).toBe(400);
    expect((await createMedia(editionId, { ...body, edition_id: otherEditionId }, `p3m-${unique}-extra`)).status).toBe(400);
    expect(queryValue(`select count(*)::int from app.event_media_asset where edition_id = '${editionId}'`)).toBe("0");

    const auditBefore = Number(queryValue("select count(*)::int from audit.audit_log where action = 'EVENT_MEDIA_ASSET_CREATED'"));
    const created = await createMedia(editionId, body, `p3m-${unique}-one`);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ edition_id: editionId, media_type: "IMAGE", storage_object_key: body.storage_object_key, alt_text: body.alt_text, status: "PENDING", sort_order: 1, focal_point: { x: 0.3, y: 0.6 } });
    const replay = await createMedia(editionId, body, `p3m-${unique}-one`);
    expect(replay.status).toBe(201);
    expect(replay.body.data.event_media_asset_id).toBe(created.body.data.event_media_asset_id);
    expect(queryValue(`select count(*)::int from app.event_media_asset where edition_id = '${editionId}'`)).toBe("1");
    expect(Number(queryValue("select count(*)::int from audit.audit_log where action = 'EVENT_MEDIA_ASSET_CREATED'")) - auditBefore).toBe(1);
    const conflict = await createMedia(editionId, { ...body, alt_text: "Otro" }, `p3m-${unique}-one`);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");

    const second = await createMedia(editionId, { media_type: "IMAGE", storage_object_key: `runiis/p3m/${unique}/podio`, alt_text: "Podio", status: "PUBLISHED" }, `p3m-${unique}-two`, operator);
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ status: "PUBLISHED", sort_order: 2, focal_point: null });

    const list = await media(editionId);
    expect(list.status).toBe(200);
    expect(list.body.data.map((a: any) => a.sort_order)).toEqual([1, 2]);
    expect((await media(editionId, "?status=PUBLISHED")).body.data).toHaveLength(1);
    const page1 = await media(editionId, "?limit=1");
    expect(page1.body.data).toHaveLength(1);
    const page2 = await media(editionId, `?limit=1&cursor=${page1.body.meta.next_cursor}`);
    expect(page2.body.data[0].event_media_asset_id).toBe(second.body.data.event_media_asset_id);
    expect(page2.body.meta.next_cursor).toBeNull();
    expect((await media(otherEditionId)).body.data).toEqual([]);
    expect((await media(editionId, "?status=DELETED")).status).toBe(400);

    expect((await createMedia(editionId, body, `p3m-${unique}-chk`, checkin)).status).toBe(403);
    expect((await createMedia(editionId, body, `p3m-${unique}-scoped`, scopedOperator)).status).toBe(403);
    expect((await createMedia(editionId, body, `p3m-${unique}-anon`, null)).status).toBe(401);
    expect((await media(editionId, "", checkin)).status).toBe(403);
    expect((await media(editionId, "", null)).status).toBe(401);
    expect((await createMedia(otherEditionId, body, `p3m-${unique}-own`, scopedOperator)).status).toBe(201);

    // The reference is usable by an IMAGE content block only once PUBLISHED.
    const block = (assetId: string) =>
      call(contentBlockPost, {
        method: "POST",
        path: `/api/v1/admin/editions/${editionId}/content-blocks`,
        params: { editionId },
        body: { block_type: "IMAGE", status: "PUBLISHED", payload: { event_media_asset_id: assetId, caption: "Foto" } },
        as: admin.client,
      });
    expect((await block(second.body.data.event_media_asset_id)).status).toBe(201);
    expect((await block(created.body.data.event_media_asset_id)).status).toBe(404);
  }, 60_000);

  test("PATCH location clears optional fields with null; absent = unchanged; required fields refuse null", async () => {
    const location = await createEditionLocation(admin.client, editionId, {
      location_type: "VENUE",
      name: "Parque Fundidora",
      address_line: "Av. Fundidora 501",
      city: "Monterrey",
      state_region: "NL",
      country_code: "MX",
      latitude: 25.6772,
      longitude: -100.2845,
    });
    const id = location.edition_location_id;
    const patch = (body: unknown, as: TestStaff | null = admin) =>
      call(locationPatch, { method: "PATCH", path: `/api/v1/admin/locations/${id}`, params: { locationId: id }, body, as: as?.client ?? null });

    const untouched = await patch({ name: "Parque Fundidora MTY" });
    expect(untouched.status).toBe(200);
    expect(untouched.body.data).toMatchObject({ name: "Parque Fundidora MTY", address_line: "Av. Fundidora 501", city: "Monterrey", state_region: "NL", country_code: "MX", latitude: 25.6772, longitude: -100.2845 });

    const cleared = await patch({ address_line: null, city: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ address_line: null, city: null, state_region: "NL", country_code: "MX", latitude: 25.6772, longitude: -100.2845 });

    const clearedRest = await patch({ state_region: null, country_code: null, latitude: null, longitude: null });
    expect(clearedRest.status).toBe(200);
    expect(clearedRest.body.data).toMatchObject({ state_region: null, country_code: null, latitude: null, longitude: null, name: "Parque Fundidora MTY" });
    expect(queryValue(`select (geometry is null)::text from app.edition_location where edition_location_id = '${id}'`)).toBe("true");

    // Coordinates are one pair: a lone value is refused, a pair is accepted, and null on either one clears the whole point.
    const lone = await patch({ latitude: 25.6 });
    expect(lone.status).toBe(400);
    expect(lone.body.error.details.reason).toBe("coordinates_must_be_paired");
    expect((await patch({ latitude: 25.6, longitude: -100.3 })).body.data).toMatchObject({ latitude: 25.6, longitude: -100.3 });
    const loneNull = await patch({ latitude: null });
    expect(loneNull.status).toBe(200);
    expect(loneNull.body.data).toMatchObject({ latitude: null, longitude: null });

    for (const field of ["name", "location_type", "is_primary", "sort_order"]) {
      const refused = await patch({ [field]: null });
      expect(refused.status, field).toBe(400);
    }
    expect((await patch({ address_line: "" })).status).toBe(400);
    expect((await patch({ address_line: null }, checkin)).status).toBe(403);
    expect((await patch({ address_line: null }, scopedOperator)).status).toBe(403);
    expect((await patch({ address_line: null }, null)).status).toBe(401);
  }, 60_000);

  test("PATCH agenda item clears description, times, modality and location with null; required fields refuse null", async () => {
    const location = await createEditionLocation(admin.client, editionId, { location_type: "MEETING_POINT", name: "Punto de reunion" });
    const modality = await createModality(admin.client, editionId, { key: `k5-${unique}`, name: "5K", official_distance_m: 5000 }, null);
    const item = await createScheduleItem(admin.client, editionId, {
      title: "Entrega de kits",
      description: "Presentar identificacion",
      local_date: day(89),
      local_start_time: "09:00",
      local_end_time: "11:00",
      modality_id: modality.modality_id,
      location_id: location.edition_location_id,
    });
    const id = item.edition_schedule_item_id;
    const patch = (body: unknown, as: TestStaff | null = admin) =>
      call(agendaPatch, { method: "PATCH", path: `/api/v1/admin/agenda/${id}`, params: { itemId: id }, body, as: as?.client ?? null });

    const unchanged = await patch({ title: "Entrega de kits (dia 1)" });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.data).toMatchObject({ description: "Presentar identificacion", local_start_time: "09:00:00", local_end_time: "11:00:00", modality_id: modality.modality_id, location_id: location.edition_location_id });

    const endWithoutStart = await patch({ local_start_time: null });
    expect(endWithoutStart.status).toBe(400);
    expect(endWithoutStart.body.error.details.reason).toBe("must_follow_start");

    const cleared = await patch({ description: null, local_start_time: null, local_end_time: null, modality_id: null, location_id: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ title: "Entrega de kits (dia 1)", description: null, local_start_time: null, local_end_time: null, modality_id: null, location_id: null, status: "ACTIVE" });

    const restored = await patch({ local_start_time: "10:00", location_id: location.edition_location_id });
    expect(restored.body.data).toMatchObject({ local_start_time: "10:00:00", location_id: location.edition_location_id });

    for (const field of ["title", "local_date", "sort_order", "status"]) {
      expect((await patch({ [field]: null })).status, field).toBe(400);
    }
    expect((await patch({ description: null }, checkin)).status).toBe(403);
    expect((await patch({ description: null }, null)).status).toBe(401);
  }, 60_000);
});
