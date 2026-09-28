import { staffRoleParamsSchema } from "@/lib/server/domain/auth/contracts";
import { revokeStaffRole } from "@/lib/server/domain/auth/service";
import { defineRoute } from "@/lib/server/http/handler";

// `id` is the staff_role_assignment_id being revoked (not the staff_member_id).
export const DELETE = defineRoute(
  { auth: { staff: ["ADMIN"] }, input: { params: staffRoleParamsSchema }, idempotency: "optional" },
  async ({ supabase, input }) => ({ data: await revokeStaffRole(supabase, input.params.id) }),
);
