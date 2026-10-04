import { invalidateCache } from "@/lib/server/cache/invalidation";
import { mediaAssetIdParamSchema, updateMediaAssetBodySchema } from "@/lib/server/domain/events/contracts";
import { runMediaAssetCommand } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// P3-O: correct a media reference's metadata (alt text, sort order, focal point; storage key only while PENDING). EVENT_CONTENT_MANAGE on the
// asset's Edition (SEC-020: scope comes from the target row). Idempotency-Key required; `expected_updated_at` in the body (stale = 409 STALE_STATE).
export const PATCH = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: mediaAssetIdParamSchema, body: updateMediaAssetBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await runMediaAssetCommand(supabase, "update", input.params.assetId, input.body, idempotency.key);
    // Only a PUBLISHED asset is on the public Edition page (its alt text and key are rendered there).
    if (result.status === "PUBLISHED") invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);
