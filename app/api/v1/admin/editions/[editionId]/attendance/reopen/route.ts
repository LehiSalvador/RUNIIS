import { editionIdParamSchema, reopenWithReasonBodySchema } from "@/lib/server/domain/closure/contracts";
import { reopenAttendanceFinalization } from "@/lib/server/domain/closure/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §98, §175. ATTENDANCE_MANAGE (ADMIN, OPERATOR). The finalization is superseded (audited, reason mandatory) so
// attendance can be corrected and finalized again. Refused with 422 CLOSURE_BLOCKED while the Edition is administratively
// closed: reopen the closure first (ADMIN, POST .../reopen).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: reopenWithReasonBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await reopenAttendanceFinalization(supabase, input.params.editionId, input.body.reason, idempotency.key),
  }),
);
