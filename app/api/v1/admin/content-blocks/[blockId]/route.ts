import { invalidateCache } from "@/lib/server/cache/invalidation";
import { contentBlockIdParamSchema, updateContentBlockBodySchema } from "@/lib/server/domain/events/contracts";
import { deleteContentBlock, updateContentBlock } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; the Edition scope comes from the target block (SEC-020, SEC-061).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: contentBlockIdParamSchema, body: updateContentBlockBodySchema } },
  async ({ supabase, input }) => {
    const result = await updateContentBlock(supabase, input.params.blockId, input.body);
    invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);

export const DELETE = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: contentBlockIdParamSchema } },
  async ({ supabase, input }) => {
    const result = await deleteContentBlock(supabase, input.params.blockId);
    invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);
