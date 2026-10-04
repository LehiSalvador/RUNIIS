import { ROUTE_REVISION_MAX_BODY_BYTES, createManualRevisionBodySchema, routeIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { createManualRevision } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// Body limit (P3-F-10): a real 10K GPX route is ~0.3-0.5 MB of JSON, far over the 64 KiB default. Same cap as import-gpx
// (4.4 MB, under the 4.5 MB Vercel platform limit); the point count (zod max 200 000 + SQL cfg_geojson_linestring) and POI count
// are still validated server-side. Oversize is the standard VALIDATION_ERROR body_too_large.

// EVENT_CONTENT_MANAGE; Master §48/§170. Always creates a DRAFT revision (source MANUAL); publish is
// a separate, explicit command.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: routeIdParamSchema, body: createManualRevisionBodySchema },
    idempotency: "optional",
    maxBodyBytes: ROUTE_REVISION_MAX_BODY_BYTES,
  },
  async ({ supabase, input, idempotency }) => ({
    data: await createManualRevision(supabase, input.params.routeId, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
