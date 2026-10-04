import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createEdition, createEvent, createModality } from "@/lib/server/domain/events/service";
import { cleanup, createTestStaff, queryValue, sql, type TestStaff } from "../helpers";
import { sessionOrAnon, sessionStore } from "../closure/harness";
import { buildClosureEdition, finishEdition, type ClosureEdition } from "../closure/fixtures";

// P3-P over the real route modules with real staff sessions against the local Postgres:
//  - a content block cannot reach PUBLISHED over a media reference that is no longer a PUBLISHED asset (the DRAFT -> asset archived -> publish
//    path), including under a real two-session race with the archive (P3-AC-06);
//  - the staff-safe actor labels on the closure projections, the route revision and the platform settings (P3-AC-09, P3-AC-11).

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon: orAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? orAnon(null) };
});

import { POST as mediaPost } from "@/app/api/v1/admin/editions/[editionId]/media-assets/route";
import { POST as contentBlockPost } from "@/app/api/v1/admin/editions/[editionId]/content-blocks/route";
import { PATCH as contentBlockPatch } from "@/app/api/v1/admin/content-blocks/[blockId]/route";
import { POST as assetArchive } from "@/app/api/v1/admin/media-assets/[assetId]/archive/route";
import { POST as routesPost } from "@/app/api/v1/admin/editions/[editionId]/routes/route";
import { POST as manualRevisionPost } from "@/app/api/v1/admin/routes/[routeId]/revisions/route";
import { GET as revisionGet } from "@/app/api/v1/admin/route-revisions/[revisionId]/route";
import { GET as settingsGet } from "@/app/api/v1/admin/platform-settings/route";
import { GET as workspaceGet } from "@/app/api/v1/admin/editions/[editionId]/attendance/route";
import { POST as resolveAttendancePost } from "@/app/api/v1/admin/registrations/[id]/attendance/resolve/route";
import { POST as resolveEligibilityPost } from "@/app/api/v1/admin/registrations/[id]/sporting-eligibility/resolve/route";
import { POST as finalizePost } from "@/app/api/v1/admin/editions/[editionId]/attendance/finalize/route";
import { POST as closePost } from "@/app/api/v1/admin/editions/[editionId]/close/route";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string | string[] | undefined>> }) => Promise<Response>;
type Res = { status: number; body: any };
const ORIGIN = process.env.APP_BASE_URL ?? "http://127.0.0.1:3100";

async function call(
  handler: unknown,
  o: { method?: "GET" | "POST" | "PATCH"; path: string; params?: Record<string, string>; body?: unknown; key?: string | null; as: SupabaseClient | null },
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.key) headers["idempotency-key"] = o.key;
  const request = new NextRequest(new URL(o.path, ORIGIN), { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const response = await sessionStore.run(sessionOrAnon(o.as), () => (handler as Handler)(request, { params: Promise.resolve(o.params ?? {}) }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("media publish re-validation and actor labels (P3-P) integration", () => {
  const authUserIds: string[] = [];
  const unique = randomUUID().slice(0, 8);
  const key = () => `p3p-${randomUUID()}`;
  let admin: TestStaff;
  let namelessAdmin: TestStaff;
  let operator: TestStaff;
  let editionId: string;
  let modalityId: string;
  let closure: ClosureEdition;

  const createMedia = async (name: string, status: "PENDING" | "PUBLISHED" = "PUBLISHED") => {
    const res = await call(mediaPost, {
      method: "POST",
      path: `/api/v1/admin/editions/${editionId}/media-assets`,
      params: { editionId },
      body: { media_type: "IMAGE", storage_object_key: `runiis/p3p/${unique}/${name}`, alt_text: `Alt ${name}`, status },
      key: key(),
      as: admin.client,
    });
    expect(res.status).toBe(201);
    return res.body.data as { event_media_asset_id: string; updated_at: string };
  };
  const draftImage = async (assetId: string) => {
    const res = await call(contentBlockPost, {
      method: "POST",
      path: `/api/v1/admin/editions/${editionId}/content-blocks`,
      params: { editionId },
      body: { block_type: "IMAGE", status: "DRAFT", payload: { event_media_asset_id: assetId } },
      as: admin.client,
    });
    expect(res.status).toBe(201);
    return res.body.data.event_content_block_id as string;
  };
  const archive = (a: { event_media_asset_id: string; updated_at: string }, as: TestStaff = admin) =>
    call(assetArchive, {
      method: "POST",
      path: `/api/v1/admin/media-assets/${a.event_media_asset_id}/archive`,
      params: { assetId: a.event_media_asset_id },
      body: { expected_updated_at: a.updated_at },
      key: key(),
      as: as.client,
    });
  const setStatus = (blockId: string, status: string, as: TestStaff = admin) =>
    call(contentBlockPatch, { method: "PATCH", path: `/api/v1/admin/content-blocks/${blockId}`, params: { blockId }, body: { status }, as: as.client });

  beforeAll(async () => {
    [admin, namelessAdmin, operator] = await Promise.all([createTestStaff("ADMIN", "GLOBAL"), createTestStaff("ADMIN", "GLOBAL"), createTestStaff("OPERATOR", "GLOBAL")]);
    authUserIds.push(admin.authUserId, namelessAdmin.authUserId, operator.authUserId);
    sql(`
      insert into app.runner_profile (auth_user_id, full_name) values
        ('${admin.authUserId}', 'Ana María García López'), ('${operator.authUserId}', 'Luis')
      on conflict (auth_user_id) do update set full_name = excluded.full_name;
    `);
    const eventId = (await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: `P3P Evento ${unique}`, canonical_key: `p3p-evento-${unique}` }, null)).event_id;
    const edition = await createEdition(
      admin.client,
      eventId,
      {
        slug: `p3p-${unique}-a`,
        name: "P3P A",
        registration_mode: "FREE",
        city: "Monterrey",
        state_region: "NL",
        schedule: { local_date: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10), local_start_time: "07:00:00" },
      },
      null,
    );
    editionId = edition.edition_id;
    modalityId = (await createModality(admin.client, editionId, { key: "10k", name: "10K", official_distance_m: 10000 }, null)).modality_id;
    closure = await buildClosureEdition(admin.client, authUserIds, { runners: 1, label: "p3p-closure" });
    finishEdition(closure.editionId);
  }, 120_000);

  afterAll(async () => {
    sql(`delete from infra.idempotency_record where actor_auth_user_id in (${authUserIds.map((id) => `'${id}'`).join(", ")})`);
    await cleanup(authUserIds);
  });

  test("DRAFT -> asset archived -> publish is refused with a stable reason; swapping to a live asset works", async () => {
    const a = await createMedia("hero");
    const blockId = await draftImage(a.event_media_asset_id);
    // A DRAFT block does not stop the archive (P3-O); the gap used to be here.
    expect((await archive(a)).status).toBe(200);

    cache.revalidateTag.mockClear();
    const refused = await setStatus(blockId, "PUBLISHED");
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe("NOT_FOUND");
    expect(refused.body.error.details).toMatchObject({ field: "payload.event_media_asset_id", reason: "media_not_published" });
    expect(cache.revalidateTag).not.toHaveBeenCalled();

    const fresh = await createMedia("hero-2");
    const swapped = await call(contentBlockPatch, {
      method: "PATCH",
      path: `/api/v1/admin/content-blocks/${blockId}`,
      params: { blockId },
      body: { status: "PUBLISHED", payload: { event_media_asset_id: fresh.event_media_asset_id } },
      as: operator.client,
    });
    expect(swapped.status).toBe(200);
    expect(swapped.body.data).toMatchObject({ status: "PUBLISHED", payload: { event_media_asset_id: fresh.event_media_asset_id } });
  });

  test("a real race between archiving the asset and publishing the DRAFT block never leaves a PUBLISHED block over an ARCHIVED asset", async () => {
    for (let round = 0; round < 4; round += 1) {
      const a = await createMedia(`race-${round}`);
      const blockId = await draftImage(a.event_media_asset_id);
      const [archived, published] = await Promise.all([archive(a, admin), setStatus(blockId, "PUBLISHED", operator)]);
      const assetStatus = queryValue(`select status from app.event_media_asset where event_media_asset_id = '${a.event_media_asset_id}'`);
      const blockStatus = queryValue(`select status from app.event_content_block where event_content_block_id = '${blockId}'`);
      // Exactly one side wins: archive first -> publish refused; publish first -> archive refused in_use.
      expect([archived.status, published.status].sort()).not.toEqual([200, 200]);
      expect(!(assetStatus === "ARCHIVED" && blockStatus === "PUBLISHED")).toBe(true);
    }
  }, 60_000);

  test("closure projections carry staff labels (ADMIN and OPERATOR read the name, a viewer without a profile name reads its own neutral view)", async () => {
    const registrationId = closure.runners[0].registrationId;
    const editionPath = `/api/v1/admin/editions/${closure.editionId}`;
    const resolved = await call(resolveAttendancePost, {
      method: "POST",
      path: `/api/v1/admin/registrations/${registrationId}/attendance/resolve`,
      params: { id: registrationId },
      body: { status: "PRESENT", reason: "Llego", evidence_metadata: { method: "MANUAL_DESK" } },
      key: key(),
      as: admin.client,
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toMatchObject({ resolved_by_staff_id: admin.staffMemberId, resolved_by_staff_label: "Ana L." });
    const eligibility = await call(resolveEligibilityPost, {
      method: "POST",
      path: `/api/v1/admin/registrations/${registrationId}/sporting-eligibility/resolve`,
      params: { id: registrationId },
      body: { status: "ELIGIBLE", distance_credit_disposition: "ALLOW" },
      key: key(),
      as: admin.client,
    });
    expect(eligibility.status).toBe(200);
    expect(eligibility.body.data).toMatchObject({ resolved_by_staff_id: admin.staffMemberId, resolved_by_staff_label: "Ana L." });
    const finalized = await call(finalizePost, { method: "POST", path: `${editionPath}/attendance/finalize`, params: { editionId: closure.editionId }, body: {}, key: key(), as: admin.client });
    expect(finalized.status).toBe(200);
    expect(finalized.body.data).toMatchObject({ finalized_by_staff_id: admin.staffMemberId, finalized_by_staff_label: "Ana L." });
    const closed = await call(closePost, { method: "POST", path: `${editionPath}/close`, params: { editionId: closure.editionId }, body: {}, key: key(), as: admin.client });
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({ status: "CLOSED", closed_by_staff_id: admin.staffMemberId, closed_by_staff_label: "Ana L." });

    const read = (as: TestStaff) => call(workspaceGet, { path: `${editionPath}/attendance`, params: { editionId: closure.editionId }, as: as.client });
    const asOperator = await read(operator);
    expect(asOperator.status).toBe(200);
    expect(asOperator.body.data.current_closure).toMatchObject({ closed_by_staff_id: admin.staffMemberId, closed_by_staff_label: "Ana L." });
    expect(asOperator.body.data.current_finalization.finalized_by_staff_label).toBe("Ana L.");
    // An ADMIN who has no profile name is still an ADMIN viewer: the label is about the TARGET, which here has a name.
    const asNameless = await read(namelessAdmin);
    expect(asNameless.body.data.current_closure.closed_by_staff_label).toBe("Ana L.");
    // Nothing that could identify the person beyond "First L." leaves in the label fields.
    const labels = JSON.stringify([asOperator.body.data.current_closure.closed_by_staff_label, asOperator.body.data.current_finalization.finalized_by_staff_label]);
    expect(labels).not.toMatch(/@|Garc|Mar[ií]a/);
  }, 120_000);

  test("route revision created_by label: the creating ADMIN reads 'Ana L.'; the same staff member acting under no profile name reads the neutral label", async () => {
    const route = await call(routesPost, {
      method: "POST",
      path: `/api/v1/admin/editions/${editionId}/routes`,
      params: { editionId },
      body: { name: `Ruta ${unique}`, modality_ids: [modalityId] },
      as: admin.client,
    });
    expect(route.status).toBe(201);
    const geometry = { type: "LineString", coordinates: [[-100.3098, 25.67], [-100.305, 25.673], [-100.3, 25.676]] };
    const make = (as: TestStaff) =>
      call(manualRevisionPost, { method: "POST", path: `/api/v1/admin/routes/${route.body.data.route_id}/revisions`, params: { routeId: route.body.data.route_id }, body: { geometry }, as: as.client });
    const byAdmin = await make(admin);
    expect(byAdmin.status).toBe(201);
    expect(byAdmin.body.data).toMatchObject({ created_by_staff_id: admin.staffMemberId, created_by_staff_label: "Ana L." });
    const byNameless = await make(namelessAdmin);
    expect(byNameless.status).toBe(201);
    const neutral = `Staff #${namelessAdmin.staffMemberId.replace(/-/g, "").slice(0, 6)}`;
    expect(byNameless.body.data.created_by_staff_label).toBe(neutral);

    const get = (id: string, as: TestStaff) =>
      call(revisionGet, { path: `/api/v1/admin/route-revisions/${id}`, params: { revisionId: id }, as: as.client });
    const readByOperator = await get(byNameless.body.data.route_revision_id, operator);
    expect(readByOperator.status).toBe(200);
    expect(readByOperator.body.data.created_by_staff_label).toBe(neutral);
    expect((await get(byAdmin.body.data.route_revision_id, namelessAdmin)).body.data.created_by_staff_label).toBe("Ana L.");
    expect(JSON.stringify(readByOperator.body.data)).not.toContain("@");
  });

  test("platform settings read carries updated_by_staff_label (additive, null when nobody updated)", async () => {
    const res = await call(settingsGet, { path: "/api/v1/admin/platform-settings", as: admin.client });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("updated_by_staff_label");
    if (res.body.data.updated_by_staff_id === null) expect(res.body.data.updated_by_staff_label).toBeNull();
    else {
      expect(typeof res.body.data.updated_by_staff_label).toBe("string");
      expect(res.body.data.updated_by_staff_label).not.toContain("@");
    }
  });
});

