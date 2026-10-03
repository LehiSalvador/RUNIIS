import { editionIdParamSchema, finalizeAttendanceBodySchema } from "@/lib/server/domain/closure/contracts";
import { finalizeAttendance } from "@/lib/server/domain/closure/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §94, §175. ATTENDANCE_MANAGE (ADMIN, OPERATOR). `mark_remaining_no_show: true` is the explicit scope confirmation
// of the bulk MarkRemainingNoShow step (Master §93): it needs `reason`, only touches PENDING rows and rolls back together
// with a refused finalization. Blocked (422 BUSINESS_RULE_VIOLATION, details.readiness) while resolutions are pending.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: finalizeAttendanceBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await finalizeAttendance(supabase, input.params.editionId, input.body, idempotency.key),
  }),
);
