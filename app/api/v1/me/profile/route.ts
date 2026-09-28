import { profilePatchSchema } from "@/lib/server/domain/auth/contracts";
import { updateMyProfile } from "@/lib/server/domain/auth/service";
import { defineRoute } from "@/lib/server/http/handler";

// Strict allowlist (Master §160, SEC-016): profilePatchSchema is z.strictObject over exactly
// phone + emergency fields; private.update_my_profile() re-enforces the same allowlist server-side.
export const PATCH = defineRoute(
  { auth: "ready", input: { body: profilePatchSchema }, idempotency: "optional" },
  async ({ supabase, input }) => ({ data: await updateMyProfile(supabase, input.body) }),
);
