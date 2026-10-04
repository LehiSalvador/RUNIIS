import { eventIdParamSchema, updateEventBodySchema } from "@/lib/server/domain/events/contracts";
import { adminGetEvent, updateEvent } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// P3-L: Event read projection (Master §27): id, name, canonical_key, event_type_key/name, status and an Edition summary. Same scope as
// the catalogue: EVENT_CONTENT_MANAGE globally, or on at least one Edition of the Event (then only those Editions are listed).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: eventIdParamSchema } },
  async ({ supabase, input }) => ({ data: await adminGetEvent(supabase, input.params.eventId) }),
);

// EVENT_CREATE is GLOBAL only; canonical_key is the Event identity and cannot change (Master §27).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: eventIdParamSchema, body: updateEventBodySchema } },
  async ({ supabase, input }) => ({ data: await updateEvent(supabase, input.params.eventId, input.body) }),
);
