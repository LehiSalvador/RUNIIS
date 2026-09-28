import { invalidateCache } from "@/lib/server/cache/invalidation";
import { cancelEditionBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only, Master §33): registration CLOSED, active holds/claims
// RELEASED, the page stays, no refund is processed here. A canceled Edition must not keep
// advertising the old state (Master §60), so the cache invalidation is immediate.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: cancelEditionBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "cancel", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionCanceled", editionId: input.params.editionId }]);
    return { data: result };
  },
);
