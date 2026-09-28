import { createKitVariantBodySchema, kitDefinitionIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createKitVariant } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// KIT_MANAGE; the Edition scope comes from the target kit definition (SEC-020).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: kitDefinitionIdParamSchema, body: createKitVariantBodySchema } },
  async ({ supabase, input }) => ({ data: await createKitVariant(supabase, input.params.kitDefinitionId, input.body), status: 201 }),
);
