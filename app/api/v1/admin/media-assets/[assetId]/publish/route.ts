import { invalidateCache } from "@/lib/server/cache/invalidation";
import { mediaAssetIdParamSchema, mediaAssetTransitionBodySchema } from "@/lib/server/domain/events/contracts";
import { runMediaAssetCommand } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// P3-O: PENDING -> PUBLISHED: from here IMAGE / GALLERY / SPONSOR_GROUP content blocks can reference the asset.
// EVENT_CONTENT_MANAGE on the asset's Edition. Idempotency-Key required; body { expected_updated_at } (stale = 409 STALE_STATE).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: mediaAssetIdParamSchema, body: mediaAssetTransitionBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await runMediaAssetCommand(supabase, "publish", input.params.assetId, input.body, idempotency.key);
    // The public Edition page lists PUBLISHED assets: it changes when one appears or disappears.
    invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);
