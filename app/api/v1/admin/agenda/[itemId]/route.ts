import { invalidateCache } from "@/lib/server/cache/invalidation";
import { agendaItemIdParamSchema, updateScheduleItemBodySchema } from "@/lib/server/domain/events/contracts";
import { deleteScheduleItem, updateScheduleItem } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; the Edition scope comes from the target agenda item (SEC-020).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: agendaItemIdParamSchema, body: updateScheduleItemBodySchema } },
  async ({ supabase, input }) => {
    const result = await updateScheduleItem(supabase, input.params.itemId, input.body);
    invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);

export const DELETE = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: agendaItemIdParamSchema } },
  async ({ supabase, input }) => {
    const result = await deleteScheduleItem(supabase, input.params.itemId);
    invalidateCache([{ type: "EditionContentChanged", editionId: result.edition_id }]);
    return { data: result };
  },
);
