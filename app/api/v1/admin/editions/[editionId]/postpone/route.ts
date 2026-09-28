import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, postponeEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only, Master §33).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: postponeEditionBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "postpone", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionPostponed", editionId: input.params.editionId }]);
    return { data: result };
  },
);
