import { editionIdParamSchema, scheduleRevisionHistoryQuerySchema } from "@/lib/server/domain/events/contracts";
import { adminListScheduleRevisions } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// P3-M: the Edition's schedule revision history (Master §29), newest first, keyset-paginated. EVENT_CONTENT_MANAGE on the Edition
// (ADMIN, OPERATOR; an EDITION-scoped OPERATOR only for their Edition). `meta` = { next_cursor, total }.
export const GET = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, query: scheduleRevisionHistoryQuerySchema },
  },
  async ({ supabase, input }) => {
    const page = await adminListScheduleRevisions(supabase, input.params.editionId, input.query);
    return { data: page.items, meta: { next_cursor: page.nextCursor, total: page.total } };
  },
);
