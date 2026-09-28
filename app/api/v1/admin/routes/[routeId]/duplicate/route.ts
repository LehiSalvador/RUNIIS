import { duplicateRouteBodySchema, routeIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { duplicateRoute } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; Master §48/§170. Copies the active (or latest) revision's geometry/POIs into
// a new Route with a new DRAFT revision (source DUPLICATED).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: routeIdParamSchema, body: duplicateRouteBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await duplicateRoute(supabase, input.params.routeId, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
