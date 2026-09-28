import { createKitDefinitionBodySchema, editionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createKitDefinition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// KIT_MANAGE (ADMIN, OPERATOR), Master §86 (definitions/variants configuration only).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: createKitDefinitionBodySchema } },
  async ({ supabase, input }) => ({ data: await createKitDefinition(supabase, input.params.editionId, input.body), status: 201 }),
);
