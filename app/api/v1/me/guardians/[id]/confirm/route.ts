import { idParamsSchema } from "@/lib/server/domain/people/contracts";
import { confirmGuardianAssignment } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute({ auth: "ready", input: { params: idParamsSchema } }, async ({ supabase, input }) => ({
  data: await confirmGuardianAssignment(supabase, input.params.id),
}));
