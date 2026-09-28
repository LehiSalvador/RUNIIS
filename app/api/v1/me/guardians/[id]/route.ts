import { idParamsSchema } from "@/lib/server/domain/people/contracts";
import { revokeGuardianAssignment } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

// Either party (or the guest owner) revokes or declines.
export const DELETE = defineRoute({ auth: "ready", input: { params: idParamsSchema } }, async ({ supabase, input }) => ({
  data: await revokeGuardianAssignment(supabase, input.params.id),
}));
