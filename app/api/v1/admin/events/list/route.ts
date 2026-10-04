import { adminEventListQuerySchema } from "@/lib/server/domain/events/contracts";
import { adminListEvents } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// P3-L: the Events catalogue (Master §27, §169). Unlike GET /api/v1/admin/events (an Editions list, kept unchanged for the UI that reads it),
// this lists Events themselves, including those with no Edition yet, with type, canonical key, status and Edition count.
// Row scope narrows by EVENT_CONTENT_MANAGE inside admin_list_events; CHECKIN/MODERATOR see an empty list, not FORBIDDEN.
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN", "MODERATOR"] }, input: { query: adminEventListQuerySchema } },
  async ({ supabase, input }) => {
    const page = await adminListEvents(supabase, input.query);
    return { data: page.items, meta: { next_cursor: page.nextCursor } };
  },
);
