import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, startEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: startEditionBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "start", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionExecutionChanged", editionId: input.params.editionId }]);
    return { data: result };
  },
);
