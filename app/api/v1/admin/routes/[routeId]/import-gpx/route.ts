import { importGpxBodySchema, routeIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { GPX_MAX_REQUEST_BODY_BYTES } from "@/lib/server/domain/routes/gpx-parser";
import { importGpxRevision } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; Master §49/§170. gpx_base64 is base64 (defineRoute only accepts
// application/json); SEC-100 caps the file after decoding (lib/server/domain/routes/gpx-parser.ts).
// The envelope cap must stay under Vercel's 4.5 MB request-body limit (a platform 413 happens before
// this handler), which is why the decoded cap is 3.25 MB, not 5 MB (AUD-030). Oversize here yields the
// standard VALIDATION_ERROR (body_too_large).
const MAX_GPX_ENVELOPE_BYTES = GPX_MAX_REQUEST_BODY_BYTES;

// GPX import always creates a DRAFT revision and never auto-publishes (Master §170).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: routeIdParamSchema, body: importGpxBodySchema },
    idempotency: "optional",
    maxBodyBytes: MAX_GPX_ENVELOPE_BYTES,
  },
  async ({ supabase, input, idempotency }) => ({
    data: await importGpxRevision(supabase, input.params.routeId, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
