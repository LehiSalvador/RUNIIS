import { friendListQuerySchema } from "@/lib/server/domain/people/contracts";
import { listMyFriendships } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const GET = defineRoute({ auth: "ready", input: { query: friendListQuerySchema } }, async ({ supabase, input }) => {
  const page = await listMyFriendships(supabase, input.query.view, input.query.cursor);
  return { data: page.items, meta: { next_cursor: page.nextCursor } };
});
