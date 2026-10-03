import { taskAssignBodySchema, taskIdParamSchema } from "@/lib/server/domain/tasks/contracts";
import { assignTask } from "@/lib/server/domain/tasks/service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/tasks/{id}/assign (ADMIN, OPERATOR). Body {assignee_id?, assigned_role?}; the assignee must be an ACTIVE staff member
// who sees the task's Edition; both null/absent clears the assignment. Idempotency-Key required.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: taskIdParamSchema, body: taskAssignBodySchema }, idempotency: "required" },
  async ({ supabase, input, idempotency }) => ({ data: await assignTask(supabase, input.params.id, input.body, idempotency.key) }),
);
