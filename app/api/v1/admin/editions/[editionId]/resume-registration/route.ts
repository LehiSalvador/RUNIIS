import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, resumeRegistrationBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_LIFECYCLE_MANAGE (ADMIN only). Requires registration_readiness.ready (Master §30-31).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: resumeRegistrationBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "resume-registration", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionRegistrationResumed", editionId: input.params.editionId }]);
    return { data: result };
  },
);
