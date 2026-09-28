import { registrationRequestListQuerySchema } from "@/lib/server/domain/registration/contracts";
import { listMyRegistrationRequests } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

export const GET = defineRoute({ auth: "ready", input: { query: registrationRequestListQuerySchema } }, async ({ supabase, input }) => {
  const page = await listMyRegistrationRequests(supabase, input.query.status, input.query.cursor);
  return { data: page.items, meta: { next_cursor: page.nextCursor } };
});
