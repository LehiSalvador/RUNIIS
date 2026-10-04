import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createEdition, createEvent } from "@/lib/server/domain/events/service";
import { cleanup, createTestStaff, queryValue, sql, type TestStaff } from "../helpers";
import { sessionOrAnon, sessionStore } from "../closure/harness";

// P3-O over the real route modules (defineRoute: same-origin guard, auth, zod, Idempotency-Key, envelope, error mapping) with real staff sessions
// against the local Postgres: the media reference lifecycle (update / publish / archive, stale protection, the in_use refusal with the referencing
// blocks, real two-session races) and the staff-safe actor labels on the schedule revision history and the Task Center (P3-AC-06, P3-AC-09, P3-AC-12).

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon: orAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? orAnon(null) };
});

import { POST as schedulePost } from "@/app/api/v1/admin/editions/[editionId]/schedule/route";
import { GET as revisionsGet } from "@/app/api/v1/admin/editions/[editionId]/schedule-revisions/route";
import { GET as editorGet } from "@/app/api/v1/admin/editions/[editionId]/route";
import { GET as mediaGet, POST as mediaPost } from "@/app/api/v1/admin/editions/[editionId]/media-assets/route";
import { POST as contentBlockPost } from "@/app/api/v1/admin/editions/[editionId]/content-blocks/route";
import { PATCH as contentBlockPatch } from "@/app/api/v1/admin/content-blocks/[blockId]/route";
import { PATCH as assetPatch } from "@/app/api/v1/admin/media-assets/[assetId]/route";
import { POST as assetPublish } from "@/app/api/v1/admin/media-assets/[assetId]/publish/route";
import { POST as assetArchive } from "@/app/api/v1/admin/media-assets/[assetId]/archive/route";
import { GET as taskListGet } from "@/app/api/v1/admin/tasks/route";
import { GET as taskGet } from "@/app/api/v1/admin/tasks/[id]/route";
import { POST as taskStart } from "@/app/api/v1/admin/tasks/[id]/start/route";

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

describe("media lifecycle and staff labels (P3-O) integration", () => {
  const authUserIds: string[] = [];
  let admin: TestStaff;
  let operator: TestStaff;
  let checkin: TestStaff;
  let scopedOperator: TestStaff;
  const unique = randomUUID().slice(0, 8);
  let eventId: string;
  let editionId: string;
  let otherEditionId: string;
  // A key per call, built at runtime: never a literal.
  const key = () => `p3o-${randomUUID()}`;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  const newEdition = (suffix: string) =>
    createEdition(
      admin.client,
      eventId,
      { slug: `p3o-${unique}-${suffix}`, name: `P3O ${suffix}`, registration_mode: "FREE", city: "Monterrey", state_region: "NL", schedule: { local_date: day(90), local_start_time: "07:00:00" } },
      null,
    );
  const createMedia = async (id: string, name: string, status: "PENDING" | "PUBLISHED" = "PENDING", as: TestStaff = admin) => {
    const res = await call(mediaPost, {
      method: "POST",
      path: `/api/v1/admin/editions/${id}/media-assets`,
      params: { editionId: id },
      body: { media_type: "IMAGE", storage_object_key: `runiis/p3o/${unique}/${name}`, alt_text: `Alt ${name}`, status },
      key: key(),
      as: as.client,
    });
    expect(res.status).toBe(201);
    return res.body.data as { event_media_asset_id: string; updated_at: string; status: string; edition_id: string };
  };
  const patchAsset = (id: string, body: unknown, k: string | null = key(), as: TestStaff | null = admin) =>
    call(assetPatch, { method: "PATCH", path: `/api/v1/admin/media-assets/${id}`, params: { assetId: id }, body, key: k, as: as?.client ?? null });
  const transition = (route: unknown, action: "publish" | "archive", id: string, body: unknown, k: string | null = key(), as: TestStaff | null = admin) =>
    call(route, { method: "POST", path: `/api/v1/admin/media-assets/${id}/${action}`, params: { assetId: id }, body, key: k, as: as?.client ?? null });
  const listMedia = (id: string, as: TestStaff = admin, query = "") =>
    call(mediaGet, { path: `/api/v1/admin/editions/${id}/media-assets${query}`, params: { editionId: id }, as: as.client });
  const asset = async (id: string) => ((await listMedia(editionId)).body.data as any[]).find((a) => a.event_media_asset_id === id);
  const block = (assetId: string, status = "PUBLISHED", type: "IMAGE" | "GALLERY" = "IMAGE", as: TestStaff = admin) =>
    call(contentBlockPost, {
      method: "POST",
      path: `/api/v1/admin/editions/${editionId}/content-blocks`,
      params: { editionId },
      body: { block_type: type, status, payload: type === "IMAGE" ? { event_media_asset_id: assetId } : { items: [{ event_media_asset_id: assetId }] } },
      as: as.client,
    });

  beforeAll(async () => {
    [admin, operator, checkin] = await Promise.all([createTestStaff("ADMIN", "GLOBAL"), createTestStaff("OPERATOR", "GLOBAL"), createTestStaff("CHECKIN", "GLOBAL")]);
    authUserIds.push(admin.authUserId, operator.authUserId, checkin.authUserId);
    eventId = (await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: `P3O Evento ${unique}`, canonical_key: `p3o-evento-${unique}` }, null)).event_id;
    editionId = (await newEdition("a")).edition_id;
    otherEditionId = (await newEdition("b")).edition_id;
    scopedOperator = await createTestStaff("OPERATOR", "EDITION", otherEditionId);
    authUserIds.push(scopedOperator.authUserId);
    // Staff carry a name only through their runner profile (optional): the ADMIN has a multi-word one, the OPERATOR one word, CHECKIN none.
    sql(`
      insert into app.runner_profile (auth_user_id, full_name) values
        ('${admin.authUserId}', 'Ana María García López'), ('${operator.authUserId}', 'Luis')
      on conflict (auth_user_id) do update set full_name = excluded.full_name;
    `);
  }, 60_000);

  afterAll(async () => {
    // The task row and its idempotency records are global state other suites count (pgTAP 720): remove what this file created.
    sql(`
      delete from app.admin_task where task_key like '%:p3o-${unique}';
      delete from infra.idempotency_record where actor_auth_user_id in (${authUserIds.map((id) => `'${id}'`).join(", ")});
    `);
    await cleanup(authUserIds);
  });

  test("metadata PATCH: key, token and strict body; a stale token is refused; replay returns the stored asset", async () => {
    const a = await createMedia(editionId, "salida");
    const id = a.event_media_asset_id;
    expect((await patchAsset(id, { expected_updated_at: a.updated_at, alt_text: "x" }, null)).status).toBe(400);
    expect((await patchAsset(id, { alt_text: "x" })).status).toBe(400);
    expect((await patchAsset(id, { expected_updated_at: a.updated_at })).status).toBe(400);
    expect((await patchAsset(id, { expected_updated_at: a.updated_at, status: "PUBLISHED" })).status).toBe(400);
    expect((await patchAsset(id, { expected_updated_at: a.updated_at, storage_object_key: "https://res.cloudinary.com/demo/image/upload/a.png" })).status).toBe(400);
    expect((await patchAsset(id, { expected_updated_at: a.updated_at, focal_point: { x: 2, y: 0 } })).status).toBe(400);
    expect((await patchAsset(randomUUID(), { expected_updated_at: a.updated_at, alt_text: "x" })).status).toBe(404);

    const k = key();
    cache.revalidateTag.mockClear();
    const body = { expected_updated_at: a.updated_at, alt_text: "Linea de salida 2027", sort_order: 7, focal_point: { x: 0.3, y: 0.6 }, storage_object_key: `runiis/p3o/${unique}/salida-ok` };
    const ok = await patchAsset(id, body, k);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ event_media_asset_id: id, status: "PENDING", alt_text: "Linea de salida 2027", sort_order: 7, storage_object_key: body.storage_object_key, focal_point: { x: 0.3, y: 0.6 } });
    expect(ok.body.data.updated_at).not.toBe(a.updated_at);
    expect(queryValue(`select count(*)::int from audit.audit_log where action = 'EVENT_MEDIA_ASSET_UPDATED' and entity_id = '${id}'`)).toBe("1");
    expect(cache.revalidateTag).not.toHaveBeenCalled(); // a PENDING asset is not on the public page

    const replay = await patchAsset(id, body, k);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(ok.body.data);
    expect(queryValue(`select count(*)::int from audit.audit_log where action = 'EVENT_MEDIA_ASSET_UPDATED' and entity_id = '${id}'`)).toBe("1");
    expect((await patchAsset(id, { ...body, alt_text: "Otro" }, k)).body.error.code).toBe("IDEMPOTENCY_CONFLICT");

    const stale = await patchAsset(id, { expected_updated_at: a.updated_at, alt_text: "Viejo" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toMatchObject({ reason: "STALE_STATE", field: "expected_updated_at", current_updated_at: expect.any(String) });
    expect((await asset(id)).alt_text).toBe("Linea de salida 2027");

    const cleared = await patchAsset(id, { expected_updated_at: ok.body.data.updated_at, focal_point: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.focal_point).toBeNull();
  }, 60_000);

  test("two sessions racing on one token: exactly one wins, the loser is STALE_STATE and nothing is lost", async () => {
    const a = await createMedia(editionId, "carrera");
    const [x, y] = await Promise.all([
      patchAsset(a.event_media_asset_id, { expected_updated_at: a.updated_at, alt_text: "Sesion A" }, key(), admin),
      patchAsset(a.event_media_asset_id, { expected_updated_at: a.updated_at, alt_text: "Sesion B" }, key(), operator),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.body.error.details).toMatchObject({ reason: "STALE_STATE" });
    const winner = x.status === 200 ? x : y;
    expect((await asset(a.event_media_asset_id)).alt_text).toBe(winner.body.data.alt_text);
  }, 60_000);

  test("publish, then archive is refused while a PUBLISHED block uses the asset and goes through once none does", async () => {
    const a = await createMedia(editionId, "podio");
    const id = a.event_media_asset_id;
    expect((await block(id)).status).toBe(404); // PENDING cannot back a block (existing rule)

    expect((await transition(assetPublish, "publish", id, { expected_updated_at: a.updated_at }, null)).status).toBe(400);
    expect((await transition(assetPublish, "publish", id, {})).status).toBe(400);
    expect((await transition(assetPublish, "publish", id, { expected_updated_at: "2026-01-01T00:00:00+00:00" })).body.error.details).toMatchObject({ reason: "STALE_STATE" });
    const k = key();
    cache.revalidateTag.mockClear();
    const published = await transition(assetPublish, "publish", id, { expected_updated_at: a.updated_at }, k);
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("PUBLISHED");
    expect(cache.revalidateTag).toHaveBeenCalled(); // the public Edition page changed
    expect((await transition(assetPublish, "publish", id, { expected_updated_at: a.updated_at }, k)).body.data).toEqual(published.body.data);
    expect(queryValue(`select count(*)::int from audit.audit_log where action = 'EVENT_MEDIA_ASSET_PUBLISHED' and entity_id = '${id}'`)).toBe("1");
    const again = await transition(assetPublish, "publish", id, { expected_updated_at: published.body.data.updated_at });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toMatchObject({ reason: "invalid_transition", current: "PUBLISHED" });
    // metadata of a PUBLISHED asset is editable, the file is not
    cache.revalidateTag.mockClear();
    const edited = await patchAsset(id, { expected_updated_at: published.body.data.updated_at, alt_text: "Podio del maraton" });
    expect(edited.status).toBe(200);
    expect(cache.revalidateTag).toHaveBeenCalled();
    const repoint = await patchAsset(id, { expected_updated_at: edited.body.data.updated_at, storage_object_key: `runiis/p3o/${unique}/otro` });
    expect(repoint.status).toBe(409);
    expect(repoint.body.error.details).toMatchObject({ reason: "not_editable", field: "storage_object_key" });

    const image = await block(id);
    expect(image.status).toBe(201);
    const gallery = await block(id, "PUBLISHED", "GALLERY");
    expect(gallery.status).toBe(201);
    const draft = await block(id, "DRAFT");
    expect(draft.status).toBe(201);

    const current = (await asset(id)).updated_at as string;
    const refused = await transition(assetArchive, "archive", id, { expected_updated_at: current });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toMatchObject({ reason: "in_use", total: 2 });
    const blocks = refused.body.error.details.blocks as { event_content_block_id: string; block_type: string; position: number }[];
    expect(blocks.map((b) => b.event_content_block_id).sort()).toEqual([image.body.data.event_content_block_id, gallery.body.data.event_content_block_id].sort());
    expect(blocks.every((b) => Object.keys(b).sort().join() === "block_type,event_content_block_id,position")).toBe(true);
    expect((await asset(id)).status).toBe("PUBLISHED");

    for (const b of [image, gallery]) {
      const blockId = b.body.data.event_content_block_id as string;
      const off = await call(contentBlockPatch, { method: "PATCH", path: `/api/v1/admin/content-blocks/${blockId}`, params: { blockId }, body: { status: "ARCHIVED" }, as: admin.client });
      expect(off.status).toBe(200);
    }
    cache.revalidateTag.mockClear();
    const archived = await transition(assetArchive, "archive", id, { expected_updated_at: current });
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("ARCHIVED");
    expect(cache.revalidateTag).toHaveBeenCalled();
    expect(queryValue(`select count(*)::int from audit.audit_log where action = 'EVENT_MEDIA_ASSET_ARCHIVED' and entity_id = '${id}'`)).toBe("1");

    // ARCHIVED is final
    const at = archived.body.data.updated_at;
    expect((await transition(assetPublish, "publish", id, { expected_updated_at: at })).body.error.details).toMatchObject({ reason: "invalid_transition" });
    expect((await transition(assetArchive, "archive", id, { expected_updated_at: at })).body.error.details).toMatchObject({ reason: "invalid_transition" });
    expect((await patchAsset(id, { expected_updated_at: at, alt_text: "x" })).body.error.details).toMatchObject({ reason: "not_editable" });
    expect((await block(id)).status).toBe(404);
  }, 90_000);

  test("a PENDING mistake can be archived and the list reads it under ARCHIVED", async () => {
    const a = await createMedia(editionId, "equivocado");
    const archived = await transition(assetArchive, "archive", a.event_media_asset_id, { expected_updated_at: a.updated_at });
    expect(archived.status).toBe(200);
    const list = await listMedia(editionId, admin, "?status=ARCHIVED");
    expect((list.body.data as any[]).map((x) => x.event_media_asset_id)).toContain(a.event_media_asset_id);
  }, 60_000);

  test("archive racing a block being published: the asset is never archived while a PUBLISHED block uses it", async () => {
    const a = await createMedia(editionId, "duelo", "PUBLISHED");
    const [archive, publishBlock] = await Promise.all([
      transition(assetArchive, "archive", a.event_media_asset_id, { expected_updated_at: a.updated_at }, key(), admin),
      block(a.event_media_asset_id, "PUBLISHED", "IMAGE", operator),
    ]);
    expect(archive.status === 200 && publishBlock.status === 201).toBe(false);
    expect([200, 409]).toContain(archive.status);
    expect([201, 404]).toContain(publishBlock.status);
    const inUse = queryValue(
      `select count(*)::int from app.event_content_block where edition_id = '${editionId}' and status = 'PUBLISHED' and payload ->> 'event_media_asset_id' = '${a.event_media_asset_id}'`,
    );
    const status = queryValue(`select status from app.event_media_asset where event_media_asset_id = '${a.event_media_asset_id}'`);
    expect(inUse === "1" && status === "ARCHIVED").toBe(false);
  }, 60_000);

  test("RBAC: ADMIN/OPERATOR with Edition scope only; CHECKIN 403, other Edition 403, anonymous 401", async () => {
    const a = await createMedia(editionId, "rbac");
    const body = { expected_updated_at: a.updated_at, alt_text: "x" };
    expect((await patchAsset(a.event_media_asset_id, body, key(), checkin)).status).toBe(403);
    expect((await patchAsset(a.event_media_asset_id, body, key(), scopedOperator)).status).toBe(403);
    expect((await patchAsset(a.event_media_asset_id, body, key(), null)).status).toBe(401);
    expect((await transition(assetPublish, "publish", a.event_media_asset_id, { expected_updated_at: a.updated_at }, key(), checkin)).status).toBe(403);
    expect((await transition(assetArchive, "archive", a.event_media_asset_id, { expected_updated_at: a.updated_at }, key(), scopedOperator)).status).toBe(403);
    expect((await transition(assetArchive, "archive", a.event_media_asset_id, { expected_updated_at: a.updated_at }, key(), null)).status).toBe(401);
    expect((await asset(a.event_media_asset_id)).alt_text).toBe("Alt rbac");

    const own = await createMedia(otherEditionId, "propia", "PENDING", scopedOperator);
    const edited = await patchAsset(own.event_media_asset_id, { expected_updated_at: own.updated_at, alt_text: "Mia" }, key(), scopedOperator);
    expect(edited.status).toBe(200);
    const published = await transition(assetPublish, "publish", own.event_media_asset_id, { expected_updated_at: edited.body.data.updated_at }, key(), scopedOperator);
    expect(published.status).toBe(200);
  }, 60_000);

  test("schedule revision history labels the actor: names for ADMIN/OPERATOR viewers, never an email or the full name", async () => {
    const editor = (as: TestStaff) => call(editorGet, { path: `/api/v1/admin/editions/${editionId}`, params: { editionId }, as: as.client });
    const edit = async (as: TestStaff, time: string) =>
      call(schedulePost, {
        method: "POST",
        path: `/api/v1/admin/editions/${editionId}/schedule`,
        params: { editionId },
        body: { local_date: day(90), local_start_time: time, reason: `Hora ${time}`, expected_updated_at: (await editor(as)).body.data.edition.updated_at },
        key: key(),
        as: as.client,
      });
    expect((await edit(operator, "07:30:00")).status).toBe(200);
    expect((await edit(admin, "08:00:00")).status).toBe(200);
    const history = (as: TestStaff | null) =>
      call(revisionsGet, { path: `/api/v1/admin/editions/${editionId}/schedule-revisions`, params: { editionId }, as: as?.client ?? null });

    const asAdmin = await history(admin);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data[0]).toMatchObject({ created_by_staff_id: admin.staffMemberId, created_by_staff_label: "Ana L." });
    expect(asAdmin.body.data[1]).toMatchObject({ created_by_staff_id: operator.staffMemberId, created_by_staff_label: "Luis" });
    const asOperator = await history(operator);
    expect(asOperator.body.data[0].created_by_staff_label).toBe("Ana L.");
    const text = JSON.stringify(asAdmin.body);
    for (const secret of [admin.email, operator.email, admin.authUserId, "García López", "María"]) expect(text).not.toContain(secret);
    expect((await history(checkin)).status).toBe(403);
    expect((await history(null)).status).toBe(401);
  }, 60_000);

  test("Task Center carries the assignee label for ADMIN/OPERATOR and only a neutral one for CHECKIN", async () => {
    const taskKey = `raceday_unknown_pass_burst:${editionId}:p3o-${unique}`;
    sql(`
      insert into app.admin_task (task_key, category, scope_type, scope_id, edition_id, title, description, priority, blocking_level, source_rule)
      values ('${taskKey}', 'RACE_DAY', 'EDITION', '${editionId}', '${editionId}', 'Rafaga', 'Rafaga de pruebas', 'HIGH', 'ACTION_REQUIRED', 'raceday_unknown_pass_burst');
    `);
    const taskId = queryValue(`select admin_task_id from app.admin_task where task_key = '${taskKey}'`) as string;
    const read = (as: TestStaff) => call(taskGet, { path: `/api/v1/admin/tasks/${taskId}`, params: { id: taskId }, as: as.client });

    expect((await read(admin)).body.data).toMatchObject({ assigned_staff_id: null, assigned_staff_label: null });
    const started = await call(taskStart, { method: "POST", path: `/api/v1/admin/tasks/${taskId}/start`, params: { id: taskId }, body: {}, key: key(), as: operator.client });
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({ assigned_staff_id: operator.staffMemberId, assigned_staff_label: "Luis" });
    expect((await read(admin)).body.data.assigned_staff_label).toBe("Luis");
    const listed = await call(taskListGet, { path: `/api/v1/admin/tasks?edition_id=${editionId}&status=ACTIVE`, as: admin.client });
    expect(listed.status).toBe(200);
    expect((listed.body.data as any[]).find((t) => t.admin_task_id === taskId)).toMatchObject({ assigned_staff_label: "Luis" });

    const asCheckin = await read(checkin);
    expect(asCheckin.status).toBe(200);
    expect(asCheckin.body.data.assigned_staff_label).toBe(`Staff #${operator.staffMemberId.replaceAll("-", "").slice(0, 6)}`);
    expect(JSON.stringify(asCheckin.body)).not.toContain("Luis");
    expect(JSON.stringify(asCheckin.body)).not.toContain(operator.email);
  }, 60_000);
});
