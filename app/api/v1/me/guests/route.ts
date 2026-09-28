import { guestFieldsSchema, guestListQuerySchema } from "@/lib/server/domain/people/contracts";
import { createGuest, listMyGuests } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const GET = defineRoute({ auth: "ready", input: { query: guestListQuerySchema } }, async ({ supabase, input }) => {
  const page = await listMyGuests(supabase, input.query.status, input.query.cursor);
  return { data: page.items, meta: { next_cursor: page.nextCursor } };
});

export const POST = defineRoute(
  { auth: "ready", input: { body: guestFieldsSchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await createGuest(supabase, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
