import { modalityIdParamSchema, setModalityCapacityBodySchema } from "@/lib/server/domain/events/contracts";
import { setModalityCapacity } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// CAPACITY_MANAGE. Lowering below occupation needs acknowledge_below_occupation; existing
// Registrations/holds are never touched (Master §35-37).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: modalityIdParamSchema, body: setModalityCapacityBodySchema } },
  async ({ supabase, input }) => ({ data: await setModalityCapacity(supabase, input.params.modalityId, input.body) }),
);
