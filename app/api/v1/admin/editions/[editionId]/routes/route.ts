import { createRouteBodySchema, editionIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { adminListRoutes, createRoute } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET: EVENT_CONTENT_MANAGE row-level scope narrows inside admin_list_routes (Master §170).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema } },
  async ({ supabase, input }) => ({ data: await adminListRoutes(supabase, input.params.editionId) }),
);

// POST: EVENT_CONTENT_MANAGE (ADMIN, OPERATOR), Master §45/§170. Every modality_id must belong to
// this Edition (composite FK in the command -> NOT_FOUND otherwise).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: createRouteBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await createRoute(supabase, input.params.editionId, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
