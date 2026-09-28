import { preferencesPatchSchema } from "@/lib/server/domain/communications/contracts";
import { getMyCommunicationPreferences, updateMyCommunicationPreferences } from "@/lib/server/domain/communications/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET/PATCH /api/v1/me/communication-preferences (Master §127, §176). Every change appends a consent
// fact; the response always reflects the resulting effective (granted AND not suppressed) state.
export const GET = defineRoute({ auth: "authenticated" }, async ({ supabase }) => {
  return { data: await getMyCommunicationPreferences(supabase) };
});

export const PATCH = defineRoute({ auth: "authenticated", input: { body: preferencesPatchSchema } }, async ({ supabase, input }) => {
  return { data: await updateMyCommunicationPreferences(supabase, input.body) };
});
