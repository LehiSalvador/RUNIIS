import { ensureRunnerProfile } from "@/lib/server/domain/auth/service";
import { defineRoute } from "@/lib/server/http/handler";

// "authenticated", not "ready": this is also how the client learns the profile is still
// PROFILE_INCOMPLETE right after sign-in, before onboarding. ensureRunnerProfile is idempotent and
// is the same safety net verifyOtp() uses, so a profile row always exists by the time this reads it
// (and IDENTITY_LOCKED still surfaces correctly for a blocked identity that kept a live session).
export const GET = defineRoute({ auth: "authenticated" }, async ({ supabase }) => ({
  data: await ensureRunnerProfile(supabase),
}));
