import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, pauseRegistrationBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only). A paused Edition must stop showing "Inscribirme" right
// away (Master §60), so the cache invalidation is immediate.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: pauseRegistrationBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "pause-registration", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionRegistrationPaused", editionId: input.params.editionId }]);
    return { data: result };
  },
);
