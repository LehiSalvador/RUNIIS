import { registrationCaptchaQuerySchema } from "@/lib/shared/registration";
import { getRegistrationCaptchaStatus } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/registration-requests/challenge?edition_id= (OD-P2-01): tells the participant UI whether the anti-hoarding ALTCHA challenge
// applies to this buyer on this Edition and, only when it must be shown, returns a fresh challenge. Authenticated, never cached (a cached
// challenge would be handed to many clients). The create endpoint is the authority; this is the proactive convenience.
export const GET = defineRoute(
  { auth: "ready", input: { query: registrationCaptchaQuerySchema } },
  async ({ supabase, input }) => ({
    data: await getRegistrationCaptchaStatus(supabase, input.query.edition_id),
    headers: { "Cache-Control": "private, no-store" },
  }),
);
