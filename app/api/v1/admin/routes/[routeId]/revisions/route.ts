import { createManualRevisionBodySchema, routeIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { createManualRevision } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; Master §48/§170. Always creates a DRAFT revision (source MANUAL); publish is
// a separate, explicit command.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: routeIdParamSchema, body: createManualRevisionBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await createManualRevision(supabase, input.params.routeId, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
