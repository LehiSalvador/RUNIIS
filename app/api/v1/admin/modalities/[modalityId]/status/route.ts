import { modalityIdParamSchema, setModalityStatusBodySchema } from "@/lib/server/domain/events/contracts";
import { setModalityStatus } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// MODALITY_MANAGE. ACTIVE <-> CLOSED, ACTIVE|CLOSED -> CANCELED (terminal); existing Registrations
// are never touched (Master §34).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: modalityIdParamSchema, body: setModalityStatusBodySchema } },
  async ({ supabase, input }) => ({ data: await setModalityStatus(supabase, input.params.modalityId, input.body) }),
);
