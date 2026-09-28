import { closeRegistrationBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: closeRegistrationBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await transitionEdition(supabase, "close-registration", input.params.editionId, input.body, idempotency?.key ?? null),
  }),
);
