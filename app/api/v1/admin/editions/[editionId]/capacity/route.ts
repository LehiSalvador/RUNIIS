import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, setGlobalCapacityBodySchema } from "@/lib/server/domain/events/contracts";
import { setEditionGlobalCapacity } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// CAPACITY_MANAGE (ADMIN, OPERATOR). Never breaks existing Registrations (Master §35-37).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: setGlobalCapacityBodySchema } },
  async ({ supabase, input }) => {
    const result = await setEditionGlobalCapacity(supabase, input.params.editionId, input.body);
    invalidateCache([{ type: "CapacityChanged", editionId: input.params.editionId }]);
    return { data: result };
  },
);
