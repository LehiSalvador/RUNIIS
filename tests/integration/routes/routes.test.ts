import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createEdition, createEvent, createModality } from "@/lib/server/domain/events/service";
import {
  adminGetRoute,
  adminGetRouteRevision,
  adminListRoutes,
  createManualRevision,
  createRoute,
  duplicateRoute,
  getEditionRoutes,
  importGpxRevision,
  publishRevision,
  validateRevision,
} from "@/lib/server/domain/routes/service";
import { AppError } from "@/lib/server/http/errors";
import { cleanup, createTestStaff, queryValue, sql, type TestStaff } from "../helpers";

// Exercises the routes/GPX admin stack end to end: real local Postgres, real RLS (auth.uid() from a
// real staff session), real zod contracts, and the real GPX parser roundtrip (a fixture file goes
// through gpx-parser.ts and the import_gpx_revision RPC). The HTTP route layer (defineRoute wiring)
// is generic and unit-tested elsewhere (tests/unit/server/handler.test.ts).

const fixturesDir = fileURLToPath(new URL("../../fixtures/gpx/", import.meta.url));
function fixtureBase64(name: string): string {
  return readFileSync(`${fixturesDir}${name}`).toString("base64");
}

const line = (offset: number) => ({
  type: "LineString" as const,
  coordinates: [
    [-100.3098 - offset, 25.67 + offset],
    [-100.305 - offset, 25.673 + offset],
    [-100.3 - offset, 25.676 + offset],
  ],
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await promise.catch((error: AppError) => {
    expect(error.code).toBe(code);
  });
}

describe("routes/GPX admin domain (T32) integration", () => {
  let admin: TestStaff;
  let checkin: TestStaff;
  let editionId: string;
  let otherEditionModalityId: string;
  let modalityId: string;

  beforeAll(async () => {
    [admin, checkin] = await Promise.all([createTestStaff("ADMIN", "GLOBAL"), createTestStaff("CHECKIN", "GLOBAL")]);

    const event = await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: "Integración Rutas", canonical_key: `it-routes-${randomUUID()}` }, null);
    const edition = await createEdition(
      admin.client,
      event.event_id,
      {
        slug: `it-routes-edicion-${randomUUID().slice(0, 8)}`,
        name: "Integración Edición Rutas",
        registration_mode: "FREE",
        city: "Monterrey",
        state_region: "NL",
        registration_close_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      },
      null,
    );
    editionId = edition.edition_id;
    const modality = await createModality(admin.client, editionId, { key: "10k", name: "10K", official_distance_m: 10000 }, null);
    modalityId = modality.modality_id;

    const otherEvent = await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: "Otra Edición", canonical_key: `it-routes-other-${randomUUID()}` }, null);
    const otherEdition = await createEdition(
      admin.client,
      otherEvent.event_id,
      { slug: `it-routes-otra-${randomUUID().slice(0, 8)}`, name: "Otra Edición", registration_mode: "FREE", city: "Monterrey", state_region: "NL", registration_close_at: new Date(Date.now() + 60 * 86_400_000).toISOString() },
      null,
    );
    const otherModality = await createModality(admin.client, otherEdition.edition_id, { key: "5k", name: "5K", official_distance_m: 5000 }, null);
    otherEditionModalityId = otherModality.modality_id;
  }, 30_000);

  afterAll(async () => {
    await cleanup([admin.authUserId, checkin.authUserId]);
  });

  test("§45 a Route can only be linked to Modalities of the same Edition", async () => {
    await expectAppError(
      createRoute(admin.client, editionId, { name: "Cross edition", modality_ids: [otherEditionModalityId] }, null),
      "NOT_FOUND",
    );
  });

  test("CHECKIN staff (no EVENT_CONTENT_MANAGE) is FORBIDDEN from creating a Route", async () => {
    await expectAppError(createRoute(checkin.client, editionId, { name: "Denied", modality_ids: [modalityId] }, null), "FORBIDDEN");
  });

  test("create Route -> manual DRAFT revision -> validate -> publish -> one PUBLISHED per Route", async () => {
    const route = await createRoute(admin.client, editionId, { name: "Ruta Integración", modality_ids: [modalityId] }, null);
    expect(route.status).toBe("DRAFT");
    expect(route.modality_ids).toEqual([modalityId]);

    const revision = await createManualRevision(
      admin.client,
      route.route_id,
      { geometry: line(0), pois: [{ poi_type: "START", name: "Salida", longitude: -100.3098, latitude: 25.67 }, { poi_type: "FINISH", name: "Meta", longitude: -100.3, latitude: 25.676 }] },
      null,
    );
    expect(revision.status).toBe("DRAFT");
    expect(revision.source).toBe("MANUAL");
    expect(revision.computed_distance_m).toBeGreaterThan(0);

    const validation = await validateRevision(admin.client, revision.route_revision_id);
    expect(validation.valid).toBe(true);
    expect(validation.warnings.some((w) => w.code === "START_FINISH_MISSING")).toBe(false);

    const published = await publishRevision(admin.client, revision.route_revision_id, null);
    expect(published.status).toBe("PUBLISHED");

    const detail = await adminGetRoute(admin.client, route.route_id);
    expect(detail.status).toBe("PUBLISHED");
    expect(detail.active_revision_id).toBe(revision.route_revision_id);
    expect(detail.revisions.filter((r) => r.status === "PUBLISHED")).toHaveLength(1);

    // A second DRAFT revision, published, must supersede the first (still exactly one PUBLISHED).
    const revision2 = await createManualRevision(admin.client, route.route_id, { geometry: line(0.001) }, null);
    await publishRevision(admin.client, revision2.route_revision_id, null);
    const detail2 = await adminGetRoute(admin.client, route.route_id);
    expect(detail2.revisions.filter((r) => r.status === "PUBLISHED")).toHaveLength(1);
    expect(detail2.revisions.find((r) => r.route_revision_id === revision.route_revision_id)?.status).toBe("SUPERSEDED");

    const list = await adminListRoutes(admin.client, editionId);
    expect(list.map((r) => r.route_id)).toContain(route.route_id);

    const revisionDetail = await adminGetRouteRevision(admin.client, revision2.route_revision_id);
    expect(revisionDetail.geometry.type).toBe("LineString");

    // Publish the Edition directly (bypasses the full readiness gate: out of T32's scope) so the
    // public projection can be exercised end to end.
    sql(`update app.edition set publication_state = 'PUBLISHED', published_at = now() where edition_id = '${editionId}'`);
    const publicRoutes = await getEditionRoutes(admin.client, editionId);
    const publicEntry = publicRoutes.find((r) => r.route_id === route.route_id);
    expect(publicEntry).toBeDefined();
    expect(publicEntry?.revision.route_revision_id).toBe(revision2.route_revision_id);
    expect(publicEntry?.revision.geometry_full.type).toBe("LineString");
    expect(publicEntry?.revision.geometry_preview.type).toBe("LineString");

    const duplicated = await duplicateRoute(admin.client, route.route_id, {}, null);
    expect(duplicated.route_id).not.toBe(route.route_id);
    const duplicatedDetail = await adminGetRoute(admin.client, duplicated.route_id);
    expect(duplicatedDetail.revisions[0]?.source).toBe("DUPLICATED");
  }, 30_000);

  test("GPX import always creates a DRAFT revision and never touches official_distance_m (Master §49)", async () => {
    const route = await createRoute(admin.client, editionId, { name: "Ruta GPX", modality_ids: [modalityId] }, null);
    const revision = await importGpxRevision(
      admin.client,
      route.route_id,
      { source_filename: "course.gpx", gpx_base64: fixtureBase64("valid_waypoints.gpx") },
      null,
    );
    expect(revision.status).toBe("DRAFT");
    expect(revision.source).toBe("GPX_IMPORT");
    expect(revision.pois.length).toBeGreaterThan(0);

    expect(queryValue(`select official_distance_m::text from app.modality where modality_id = '${modalityId}'`)).toBe("10000");
  });

  test("a hostile GPX file (billion laughs) is refused before any DB write", async () => {
    const route = await createRoute(admin.client, editionId, { name: "Ruta Hostil", modality_ids: [modalityId] }, null);
    await expectAppError(
      importGpxRevision(admin.client, route.route_id, { source_filename: "evil.gpx", gpx_base64: fixtureBase64("billion_laughs.gpx") }, null),
      "VALIDATION_ERROR",
    );
  });
});
