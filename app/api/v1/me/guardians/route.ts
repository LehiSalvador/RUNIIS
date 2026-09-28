import { guardianCreateSchema, guardianListQuerySchema } from "@/lib/server/domain/people/contracts";
import { createGuardianAssignment, listMyGuardianAssignments } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const GET = defineRoute({ auth: "ready", input: { query: guardianListQuerySchema } }, async ({ supabase, input }) => ({
  data: await listMyGuardianAssignments(supabase, input.query.include_revoked === "true"),
}));

export const POST = defineRoute({ auth: "ready", input: { body: guardianCreateSchema } }, async ({ supabase, input }) => ({
  data: await createGuardianAssignment(supabase, input.body),
  status: 201,
}));
