import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, finishEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only): registration CLOSED, closure_state OPEN -> PENDING.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: finishEditionBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "finish", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionExecutionChanged", editionId: input.params.editionId }]);
    return { data: result };
  },
);
