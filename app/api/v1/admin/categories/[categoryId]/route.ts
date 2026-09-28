import { invalidateCache } from "@/lib/server/cache/invalidation";
import { categoryIdParamSchema, updateCategoryBodySchema } from "@/lib/server/domain/events/contracts";
import { updateCategory } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// MODALITY_MANAGE; the Edition scope comes from the target Category (SEC-020).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: categoryIdParamSchema, body: updateCategoryBodySchema } },
  async ({ supabase, input }) => {
    const result = await updateCategory(supabase, input.params.categoryId, input.body);
    invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);
