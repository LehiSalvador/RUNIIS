import { listMessagesQuerySchema } from "@/lib/server/domain/communications/contracts";
import { listCommunicationMessages } from "@/lib/server/domain/communications/admin-service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/admin/communications/messages (Master §176). Emails are masked server-side.
export const GET = defineRoute({ auth: { staff: ["ADMIN", "OPERATOR"] }, input: { query: listMessagesQuerySchema } }, async ({ supabase, input }) => {
  const page = await listCommunicationMessages(supabase, input.query);
  return { data: page.items, meta: { has_more: page.has_more } };
});
