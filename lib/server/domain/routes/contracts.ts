import "server-only";
import { z } from "zod";

// Output schemas mirror the jsonb projections in supabase/migrations/20260928120000_320_routes_commands.sql
// and 20260928120100_321_routes_queries.sql (private.route_projection / route_revision_projection /
// get_edition_routes) exactly (SEC-120): an unexpected key fails closed as INTERNAL_ERROR instead of
// reaching the client. Input schemas are intentionally thinner than the SQL `cfg_*` validators: they
// reject the wrong shape/type at the edge while the database remains the single source of truth
// (ADR-001 §2/§9) and re-validates every coordinate itself (SEC-006/100).

const id = z.guid();
const timestamp = z.string().min(1);

const MAX_GEOMETRY_POINTS = 200_000;
const MAX_POIS = 200;

export const poiTypeSchema = z.enum(["START", "FINISH", "HYDRATION", "MEDICAL", "CHECKPOINT", "RESTROOM", "VIEWPOINT", "OTHER"]);

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

// Input: what an editor (F4) or the GPX parser produces. Coordinate order is [lon, lat] (Master §46).
export const geoJsonLineStringInputSchema = z.strictObject({
  type: z.literal("LineString"),
  coordinates: z.array(lonLat).min(2).max(MAX_GEOMETRY_POINTS),
});

// Output: whatever ST_AsGeoJSON produced. Kept permissive on precision/shape beyond the type+array
// check — the DB is the source of truth for the persisted geometry.
export const geoJsonLineStringOutputSchema = z.strictObject({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

export const poiInputSchema = z.strictObject({
  poi_type: poiTypeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(0).max(500).optional(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

export const poiOutputSchema = z.strictObject({
  route_poi_id: id,
  poi_type: poiTypeSchema,
  name: z.string(),
  longitude: z.number(),
  latitude: z.number(),
  sort_order: z.int(),
  metadata: z.record(z.string(), z.unknown()),
});

export const routeSchema = z.strictObject({
  route_id: id,
  edition_id: id,
  name: z.string(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  active_revision_id: id.nullable(),
  modality_ids: z.array(id),
  created_at: timestamp,
  updated_at: timestamp,
});

export const validationResultSchema = z.strictObject({
  valid: z.boolean(),
  errors: z.array(z.strictObject({ code: z.string(), detail: z.record(z.string(), z.unknown()).optional() })),
  warnings: z.array(z.strictObject({ code: z.string(), detail: z.record(z.string(), z.unknown()).optional() })),
  validated_at: timestamp.optional(),
});

// validation_result defaults to '{}' until the first validate/publish call.
const emptyOrValidationResultSchema = z.union([z.strictObject({}), validationResultSchema]);

export const routeRevisionSchema = z.strictObject({
  route_revision_id: id,
  route_id: id,
  edition_id: id,
  revision: z.int(),
  status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"]),
  source: z.enum(["MANUAL", "GPX_IMPORT", "DUPLICATED"]),
  source_filename: z.string().nullable(),
  geometry: geoJsonLineStringOutputSchema,
  computed_distance_m: z.int().nullable(),
  validation_result: emptyOrValidationResultSchema,
  pois: z.array(poiOutputSchema),
  created_by_staff_id: id,
  // Staff-safe label (P3-P, private.staff_display_label); viewer-dependent, optional so older fixtures keep parsing.
  created_by_staff_label: z.string().optional(),
  created_at: timestamp,
  published_at: timestamp.nullable(),
  superseded_at: timestamp.nullable(),
});

const revisionSummarySchema = z.strictObject({
  route_revision_id: id,
  revision: z.int(),
  status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"]),
  source: z.enum(["MANUAL", "GPX_IMPORT", "DUPLICATED"]),
  computed_distance_m: z.int().nullable(),
  created_at: timestamp,
  published_at: timestamp.nullable(),
  superseded_at: timestamp.nullable(),
});

export const routeWithRevisionsSchema = routeSchema.extend({ revisions: z.array(revisionSummarySchema) });
export const routeListSchema = z.array(routeSchema);

// ---- Public projection (F1 event page, via T31 discovery; F4 admin editor detail view) ----

export const publicRoutePoiSchema = z.strictObject({
  route_poi_id: id,
  poi_type: poiTypeSchema,
  name: z.string(),
  longitude: z.number(),
  latitude: z.number(),
  sort_order: z.int(),
  metadata: z.record(z.string(), z.unknown()),
});

export const publicRouteSchema = z.strictObject({
  route_id: id,
  name: z.string(),
  modality_ids: z.array(id),
  revision: z.strictObject({
    route_revision_id: id,
    revision: z.int(),
    published_at: timestamp.nullable(),
    computed_distance_m: z.int().nullable(),
    geometry_preview: geoJsonLineStringOutputSchema,
    geometry_full: geoJsonLineStringOutputSchema,
    pois: z.array(publicRoutePoiSchema),
  }),
});
export const publicRouteListSchema = z.array(publicRouteSchema);

// ---- Params ----

export const editionIdParamSchema = z.strictObject({ editionId: id });
export const routeIdParamSchema = z.strictObject({ routeId: id });
export const routeRevisionIdParamSchema = z.strictObject({ revisionId: id });

// ---- Bodies ----

export const createRouteBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  modality_ids: z.array(id).min(1).max(20),
});

export const createManualRevisionBodySchema = z.strictObject({
  geometry: geoJsonLineStringInputSchema,
  pois: z.array(poiInputSchema).max(MAX_POIS).optional(),
});

// The GPX file is base64-encoded so it fits the JSON envelope (defineRoute only accepts
// application/json); the byte cap (SEC-100) is enforced on the decoded bytes in gpx-parser.ts, not on
// this string's length (base64 inflates size ~33%). See T32 decisions in the handoff.
// AUD-030 / P1-AC-13: the string cap is the largest base64 text that decodes to GPX_MAX_DECODED_BYTES
// (4 chars per 3 bytes, padded). gpx-parser.ts owns the decoded-byte limit and exports the same value as
// GPX_MAX_BASE64_CHARS, but it imports this module, so the figure is derived here to avoid an import
// cycle; tests/unit/routes/gpx-contract.test.ts asserts both constants stay equal.
const GPX_MAX_DECODED_BYTES_FOR_CONTRACT = 3_250_000;
export const IMPORT_GPX_MAX_BASE64_CHARS = Math.ceil(GPX_MAX_DECODED_BYTES_FOR_CONTRACT / 3) * 4;
export const importGpxBodySchema = z.strictObject({
  source_filename: z.string().trim().min(1).max(200),
  gpx_base64: z.string().min(1).max(IMPORT_GPX_MAX_BASE64_CHARS),
});

export const updateRevisionBodySchema = z
  .strictObject({
    geometry: geoJsonLineStringInputSchema.optional(),
    pois: z.array(poiInputSchema).max(MAX_POIS).optional(),
  })
  .refine((v) => v.geometry !== undefined || v.pois !== undefined, { message: "at_least_one_field_required" });

export const duplicateRouteBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(160).optional(),
  modality_ids: z.array(id).min(1).max(20).optional(),
});
