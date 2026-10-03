import { taskListQuerySchema } from "@/lib/server/domain/tasks/contracts";
import { listTasks } from "@/lib/server/domain/tasks/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/admin/tasks (Master §142-143, Roadmap §9.26). Any staff role may read; the database scopes the rows to the caller's
// Editions and role (ADMIN/OPERATOR see every task, CHECKIN only race-day tasks, MODERATOR only moderation tasks). Default filter: active
// tasks (`status=ALL` for history), blockers first. A pure read: the projection is refreshed by the cron job and by POST /tasks/refresh.
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN", "MODERATOR"] }, input: { query: taskListQuerySchema } },
  async ({ supabase, input }) => {
    const page = await listTasks(supabase, input.query);
    return { data: page.items, meta: { next_cursor: page.nextCursor, counts: page.counts } };
  },
);
