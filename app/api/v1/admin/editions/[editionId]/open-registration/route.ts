import { editionIdParamSchema, openRegistrationBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only). Requires registration_readiness.ready (Master §30-31).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: openRegistrationBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await transitionEdition(supabase, "open-registration", input.params.editionId, input.body, idempotency?.key ?? null),
  }),
);
