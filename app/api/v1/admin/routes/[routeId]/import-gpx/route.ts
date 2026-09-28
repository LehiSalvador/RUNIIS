import { importGpxBodySchema, routeIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { importGpxRevision } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; Master §49/§170. gpx_base64 is base64 (defineRoute only accepts
// application/json); SEC-100 caps the file at 5MB after decoding (lib/server/domain/routes/gpx-parser.ts).
// maxBodyBytes here is a generous envelope cap only — base64 inflates a 5MB file to ~6.7MB.
const MAX_GPX_ENVELOPE_BYTES = 7_500_000;

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
