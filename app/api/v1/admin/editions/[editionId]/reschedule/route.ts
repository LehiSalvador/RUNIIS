import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, rescheduleEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only, Master §29/§33): SCHEDULED|POSTPONED -> SCHEDULED with a date.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: rescheduleEditionBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "reschedule", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionRescheduled", editionId: input.params.editionId }]);
    return { data: result };
  },
);
