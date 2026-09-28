import { locationIdParamSchema, updateLocationBodySchema } from "@/lib/server/domain/events/contracts";
import { deleteEditionLocation, updateEditionLocation } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; the Edition scope comes from the target Location (SEC-020).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: locationIdParamSchema, body: updateLocationBodySchema } },
  async ({ supabase, input }) => ({ data: await updateEditionLocation(supabase, input.params.locationId, input.body) }),
);

export const DELETE = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: locationIdParamSchema } },
  async ({ supabase, input }) => ({ data: await deleteEditionLocation(supabase, input.params.locationId) }),
);
