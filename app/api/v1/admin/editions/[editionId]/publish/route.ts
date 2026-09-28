import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, publishEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_PUBLISH (ADMIN only). Requires publication_readiness.ready (Master §30-31).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: publishEditionBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "publish", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionPublished", editionId: input.params.editionId }]);
    return { data: result };
  },
);
