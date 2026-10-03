import { registrationIdParamSchema, resolveSportingEligibilityBodySchema } from "@/lib/server/domain/closure/contracts";
import { resolveSportingEligibility } from "@/lib/server/domain/closure/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §92, §175. ATTENDANCE_MANAGE (ADMIN, OPERATOR); Edition scope from the target registration. Refused with
// 422 CLOSURE_BLOCKED once the Edition is administratively closed (reopen first).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: registrationIdParamSchema, body: resolveSportingEligibilityBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await resolveSportingEligibility(supabase, input.params.id, input.body, idempotency.key),
  }),
);
