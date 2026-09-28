import { agendaItemIdParamSchema, updateScheduleItemBodySchema } from "@/lib/server/domain/events/contracts";
import { deleteScheduleItem, updateScheduleItem } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; the Edition scope comes from the target agenda item (SEC-020).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: agendaItemIdParamSchema, body: updateScheduleItemBodySchema } },
  async ({ supabase, input }) => ({ data: await updateScheduleItem(supabase, input.params.itemId, input.body) }),
);

export const DELETE = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: agendaItemIdParamSchema } },
  async ({ supabase, input }) => ({ data: await deleteScheduleItem(supabase, input.params.itemId) }),
);
