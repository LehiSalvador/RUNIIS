import { taskCloseBodySchema, taskIdParamSchema } from "@/lib/server/domain/tasks/contracts";
import { waiveTask } from "@/lib/server/domain/tasks/service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/tasks/{id}/waive (ADMIN, OPERATOR). Body {reason}. Same CLOSURE_BLOCKER rule as resolve: the root decides. A waived task
// stays waived (the sync never re-raises it). Idempotency-Key required.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: taskIdParamSchema, body: taskCloseBodySchema }, idempotency: "required" },
  async ({ supabase, input, idempotency }) => ({ data: await waiveTask(supabase, input.params.id, input.body.reason, idempotency.key) }),
);
