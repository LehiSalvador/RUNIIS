import { invalidateCache } from "@/lib/server/cache/invalidation";
import { createModalityBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createModality } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// MODALITY_MANAGE (ADMIN, OPERATOR), Master §34.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: createModalityBodySchema },
    idempotency: "optional",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await createModality(supabase, input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionContentChanged", editionId: input.params.editionId }]);
    return { data: result, status: 201 };
  },
);
