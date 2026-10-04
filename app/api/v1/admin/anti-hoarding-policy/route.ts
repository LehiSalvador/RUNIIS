import { updateAntiHoardingPolicyBodySchema } from "@/lib/server/domain/events/contracts";
import { adminGetAntiHoardingPolicy, updateAntiHoardingPolicy } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// Anti-hoarding policy (owner decision OD-P2-01, P3-D): the ALTCHA new-account window and the hold-concentration alert thresholds.
// PLATFORM_SETTINGS_MANAGE is GLOBAL ADMIN only (Master §145, §155): OPERATOR does not read it either. The commands authorise again
// in the database; the update validates ranges, audits ANTI_HOARDING_POLICY_UPDATED and requires an Idempotency-Key (a replay of a
// completed key returns the stored policy and neither writes nor audits again). Changing the policy never cancels or blocks anything.
export const GET = defineRoute({ auth: { staff: ["ADMIN"] } }, async ({ supabase }) => ({ data: await adminGetAntiHoardingPolicy(supabase) }));

export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { body: updateAntiHoardingPolicyBodySchema }, idempotency: "required" },
  async ({ supabase, input, idempotency }) => ({ data: await updateAntiHoardingPolicy(supabase, input.body, idempotency.key) }),
);
