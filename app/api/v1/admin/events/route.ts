import { adminEditionListQuerySchema, createEventBodySchema } from "@/lib/server/domain/events/contracts";
import { adminListEditions, createEvent } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §169: the admin Editions list (filterable, cursor-paginated). Row-level scope narrows by
// EVENT_CONTENT_MANAGE inside admin_list_editions; CHECKIN/MODERATOR see an empty list, not FORBIDDEN.
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN", "MODERATOR"] }, input: { query: adminEditionListQuerySchema } },
  async ({ supabase, input }) => {
    const page = await adminListEditions(supabase, input.query);
    return { data: page.items, meta: { next_cursor: page.nextCursor } };
  },
);

// EVENT_CREATE is GLOBAL only (Master §27).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { body: createEventBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await createEvent(supabase, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
