import { getMyLegalStatus } from "@/lib/server/domain/auth/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/me/legal (OWN-05): current TERMS_OF_SERVICE / PRIVACY_NOTICE versions and whether the signed-in
// account accepted them (`needs_acceptance`, `needs_reacceptance`). "authenticated", not "ready": the
// onboarding screen reads it before the profile is READY. Authorization is the caller's own profile (DB);
// nothing about other accounts is readable. Read-only: no idempotency, no audit.
export const GET = defineRoute({ auth: "authenticated" }, async ({ supabase }) => ({
  data: await getMyLegalStatus(supabase),
}));
