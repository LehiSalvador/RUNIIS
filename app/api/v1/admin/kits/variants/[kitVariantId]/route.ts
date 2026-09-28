import { invalidateCache } from "@/lib/server/cache/invalidation";
import { kitVariantIdParamSchema, updateKitVariantBodySchema } from "@/lib/server/domain/events/contracts";
import { updateKitVariant } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// KIT_MANAGE. Capacity below live allocations needs acknowledge_below_allocation; allocations are
// never touched.
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: kitVariantIdParamSchema, body: updateKitVariantBodySchema } },
  async ({ supabase, input }) => {
    const result = await updateKitVariant(supabase, input.params.kitVariantId, input.body);
    invalidateCache([{ type: "EditionContentChanged", editionId: result.kit.edition_id }]);
    return { data: result };
  },
);
