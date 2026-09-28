import { createEditionReminder } from "@/lib/server/domain/communications/service";
import { editionIdParamSchema } from "@/lib/server/domain/communications/contracts";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/events/:editionId/reminders (Master §127-130, §176): logged-in "Recordarme" — the
// auth email is already verified, so the subscription activates immediately. Anonymous reminders are
// a separate route (POST /api/v1/reminders) since they need an email address and email confirmation.
export const POST = defineRoute({ auth: "authenticated", input: { params: editionIdParamSchema } }, async ({ supabase, input }) => {
  return { data: await createEditionReminder(supabase, input.params.edition) };
});
