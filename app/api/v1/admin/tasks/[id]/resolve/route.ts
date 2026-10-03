import { taskCloseBodySchema, taskIdParamSchema } from "@/lib/server/domain/tasks/contracts";
import { resolveTask } from "@/lib/server/domain/tasks/service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/admin/tasks/{id}/resolve (ADMIN, OPERATOR). Body {reason}. A CLOSURE_BLOCKER cannot be resolved while its root condition still
// holds: 422 BUSINESS_RULE_VIOLATION {reason: "source_condition_open", task_key, related_entity_type, related_entity_id}. Idempotency-Key required.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: taskIdParamSchema, body: taskCloseBodySchema }, idempotency: "required" },
  async ({ supabase, input, idempotency }) => ({ data: await resolveTask(supabase, input.params.id, input.body.reason, idempotency.key) }),
);
