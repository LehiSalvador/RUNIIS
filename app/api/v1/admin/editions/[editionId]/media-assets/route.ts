import { invalidateCache } from "@/lib/server/cache/invalidation";
import { createMediaAssetBodySchema, editionIdParamSchema, mediaAssetListQuerySchema } from "@/lib/server/domain/events/contracts";
import { adminListMediaAssets, createMediaAsset } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// P3-M: Edition media references (Master §52). EVENT_CONTENT_MANAGE on the Edition (ADMIN, OPERATOR). There is no upload pipeline here:
// a reference names a Cloudinary asset that already exists. IMAGE / GALLERY / SPONSOR_GROUP content blocks can only use a PUBLISHED one.
export const GET = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, query: mediaAssetListQuerySchema },
  },
  async ({ supabase, input }) => {
    const page = await adminListMediaAssets(supabase, input.params.editionId, input.query);
    return { data: page.items, meta: { next_cursor: page.nextCursor } };
  },
);

export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: createMediaAssetBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await createMediaAsset(supabase, input.params.editionId, input.body, idempotency.key);
    // Only a PUBLISHED asset reaches the public Edition page (discovery media list).
    if (result.status === "PUBLISHED") invalidateCache([{ type: "EditionContentChanged", editionId: input.params.editionId }]);
    return { data: result, status: 201 };
  },
);
