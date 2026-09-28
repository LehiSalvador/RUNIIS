import { createContentBlockBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createContentBlock } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE (ADMIN, OPERATOR), Master §51, SEC-061.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: createContentBlockBodySchema },
  },
  async ({ supabase, input }) => ({ data: await createContentBlock(supabase, input.params.editionId, input.body), status: 201 }),
);
