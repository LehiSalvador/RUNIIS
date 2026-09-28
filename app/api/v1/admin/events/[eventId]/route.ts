import { eventIdParamSchema, updateEventBodySchema } from "@/lib/server/domain/events/contracts";
import { updateEvent } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CREATE is GLOBAL only; canonical_key is the Event identity and cannot change (Master §27).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: eventIdParamSchema, body: updateEventBodySchema } },
  async ({ supabase, input }) => ({ data: await updateEvent(supabase, input.params.eventId, input.body) }),
);
