import { staffGrantBodySchema } from "@/lib/server/domain/auth/contracts";
import { grantStaffRole, listStaffRoles } from "@/lib/server/domain/auth/service";
import { defineRoute } from "@/lib/server/http/handler";

// Route guard is an early reject only (any-scope ADMIN); private.require_permission('STAFF_ROLES_MANAGE', null)
// re-authorises GLOBAL ADMIN specifically (Master §144-145, SEC-021/022).
export const GET = defineRoute({ auth: { staff: ["ADMIN"] } }, async ({ supabase }) => ({
  data: await listStaffRoles(supabase),
}));

export const POST = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { body: staffGrantBodySchema }, idempotency: "optional" },
  async ({ supabase, input }) => ({ data: await grantStaffRole(supabase, input.body), status: 201 }),
);
