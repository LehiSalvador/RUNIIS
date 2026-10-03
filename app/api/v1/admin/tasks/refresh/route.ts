import { taskRefreshBodySchema } from "@/lib/server/domain/tasks/contracts";
import { refreshTasks } from "@/lib/server/domain/tasks/service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/tasks/refresh (ADMIN, OPERATOR; authorised on body.edition_id by the database, SEC-020). Recomputes that Edition's
// projected tasks (attendance pending, closure pending, integrity issues, hoarding alert) from their sources. Idempotency-Key required.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { body: taskRefreshBodySchema }, idempotency: "required" },
  async ({ supabase, input, idempotency }) => ({ data: await refreshTasks(supabase, input.body.edition_id, idempotency.key) }),
);
