import { idParamsSchema, staffRevokeSchema } from "@/lib/server/domain/people/contracts";
import { staffRevokeGuardianAssignment } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

// Early reject only; the command re-checks GUARDIAN_ASSIGNMENT_MANAGE (GLOBAL ADMIN).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: idParamsSchema, body: staffRevokeSchema } },
  async ({ supabase, input }) => ({
    data: await staffRevokeGuardianAssignment(supabase, input.params.id, input.body.reason),
  }),
);
