import { ROUTE_REVISION_MAX_BODY_BYTES, routeRevisionIdParamSchema, updateRevisionBodySchema } from "@/lib/server/domain/routes/contracts";
import { adminGetRouteRevision, updateRevision } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// Body limit (P3-F-10): a real 10K GPX route is ~0.3-0.5 MB of JSON, far over the 64 KiB default. Same cap as import-gpx
// (4.4 MB, under the 4.5 MB Vercel platform limit); the point count (zod max 200 000 + SQL cfg_geojson_linestring) and POI count
// are still validated server-side. Oversize is the standard VALIDATION_ERROR body_too_large.

// EVENT_CONTENT_MANAGE; the Edition scope comes from the target revision's Route (SEC-020).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: routeRevisionIdParamSchema } },
  async ({ supabase, input }) => ({ data: await adminGetRouteRevision(supabase, input.params.revisionId) }),
);

// PATCH: only a DRAFT revision may be edited (Master §48); geometry and/or pois, at least one.
export const PATCH = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: routeRevisionIdParamSchema, body: updateRevisionBodySchema },
    maxBodyBytes: ROUTE_REVISION_MAX_BODY_BYTES,
  },
  async ({ supabase, input }) => ({ data: await updateRevision(supabase, input.params.revisionId, input.body) }),
);
