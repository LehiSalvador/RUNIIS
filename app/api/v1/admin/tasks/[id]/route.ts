import { taskIdParamSchema } from "@/lib/server/domain/tasks/contracts";
import { getTask } from "@/lib/server/domain/tasks/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/admin/tasks/{id}: the task, its root-object link hint and `source_holds` (does the root condition still hold now).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN", "MODERATOR"] }, input: { params: taskIdParamSchema } },
  async ({ supabase, input }) => ({ data: await getTask(supabase, input.params.id) }),
);
