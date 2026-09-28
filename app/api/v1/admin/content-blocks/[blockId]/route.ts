import { contentBlockIdParamSchema, updateContentBlockBodySchema } from "@/lib/server/domain/events/contracts";
import { deleteContentBlock, updateContentBlock } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; the Edition scope comes from the target block (SEC-020, SEC-061).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: contentBlockIdParamSchema, body: updateContentBlockBodySchema } },
  async ({ supabase, input }) => ({ data: await updateContentBlock(supabase, input.params.blockId, input.body) }),
);

export const DELETE = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: contentBlockIdParamSchema } },
  async ({ supabase, input }) => ({ data: await deleteContentBlock(supabase, input.params.blockId) }),
);
