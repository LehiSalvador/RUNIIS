import { taskIdParamSchema } from "@/lib/server/domain/tasks/contracts";
import { startTask } from "@/lib/server/domain/tasks/service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/tasks/{id}/start (ADMIN, OPERATOR; Edition scope from the task row). OPEN/WAITING_EXTERNAL -> IN_PROGRESS; the starter
// takes an unassigned task. Body {}. Idempotency-Key required.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: taskIdParamSchema }, idempotency: "required" },
  async ({ supabase, input, idempotency }) => ({ data: await startTask(supabase, input.params.id, idempotency.key) }),
);
