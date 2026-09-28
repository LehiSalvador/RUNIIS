import { createCategoryBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createCategory } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// MODALITY_MANAGE (ADMIN, OPERATOR), Master §39.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: createCategoryBodySchema } },
  async ({ supabase, input }) => ({ data: await createCategory(supabase, input.params.editionId, input.body), status: 201 }),
);
