import { peopleSearchQuerySchema } from "@/lib/server/domain/people/contracts";
import { searchPeople } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §23: session required, 20 per page, 60 requests / 10 min / user.
export const GET = defineRoute({ auth: "ready", input: { query: peopleSearchQuerySchema } }, async ({ supabase, input }) => {
  const page = await searchPeople(supabase, input.query.q, input.query.cursor);
  return { data: page.items, meta: { next_cursor: page.nextCursor } };
});
