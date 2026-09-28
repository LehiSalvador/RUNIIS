import { invalidateCache } from "@/lib/server/cache/invalidation";
import { closeRegistrationBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only). A closed Edition must stop showing "Inscribirme" right
// away (Master §60), so the cache invalidation is immediate.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: closeRegistrationBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "close-registration", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionRegistrationClosed", editionId: input.params.editionId }]);
    return { data: result };
  },
);
