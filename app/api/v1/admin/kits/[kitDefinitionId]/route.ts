import { kitDefinitionIdParamSchema, updateKitDefinitionBodySchema } from "@/lib/server/domain/events/contracts";
import { updateKitDefinition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// KIT_MANAGE; the Edition scope comes from the target kit definition (SEC-020).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: kitDefinitionIdParamSchema, body: updateKitDefinitionBodySchema } },
  async ({ supabase, input }) => ({ data: await updateKitDefinition(supabase, input.params.kitDefinitionId, input.body) }),
);
