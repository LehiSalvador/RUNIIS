import { cancelReminder } from "@/lib/server/domain/communications/service";
import { reminderIdParamSchema } from "@/lib/server/domain/communications/contracts";
import { defineRoute } from "@/lib/server/http/handler";

// DELETE /api/v1/reminders/:reminderId (Master §127-130, §176). Ownership is enforced inside the
// command (foreign reminder ids are NOT_FOUND, SEC-020).
export const DELETE = defineRoute({ auth: "authenticated", input: { params: reminderIdParamSchema } }, async ({ supabase, input }) => {
  return { data: await cancelReminder(supabase, input.params.reminderId) };
});
