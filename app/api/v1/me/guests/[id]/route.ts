import { guestPatchSchema, idParamsSchema } from "@/lib/server/domain/people/contracts";
import { archiveGuest, updateGuest } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const PATCH = defineRoute(
  { auth: "ready", input: { params: idParamsSchema, body: guestPatchSchema } },
  async ({ supabase, input }) => ({ data: await updateGuest(supabase, input.params.id, input.body) }),
);

// Guests are never deleted (Master §25): DELETE archives.
export const DELETE = defineRoute({ auth: "ready", input: { params: idParamsSchema } }, async ({ supabase, input }) => ({
  data: await archiveGuest(supabase, input.params.id),
}));
