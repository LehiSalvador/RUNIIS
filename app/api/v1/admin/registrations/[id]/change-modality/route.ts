import { invalidateCache } from "@/lib/server/cache/invalidation";
import { registrationIdParamSchema } from "@/lib/server/domain/closure/contracts";
import { changeRegistrationModality, registrationEditionIdForStaff } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";
import { changeModalityBodySchema } from "@/lib/shared/closure";

// Master §78-79, §172. REGISTRATION_MANAGE (ADMIN, OPERATOR); Edition scope from the target registration. The target
// modality needs a free place (409 CAPACITY_UNAVAILABLE / GLOBAL_CAPACITY_UNAVAILABLE), must be ACTIVE, match the participant's
// eligibility rules and category (422 MODALITY_NOT_AVAILABLE / PARTICIPANT_NOT_ELIGIBLE / FORM_INVALID). Same key + same body
// replays. Blocked once attendance is finalized (422 CLOSURE_BLOCKED).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: registrationIdParamSchema, body: changeModalityBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await changeRegistrationModality(supabase, input.params.id, input.body, idempotency.key);
    // The per-modality capacity moves with the registration.
    const editionId = await registrationEditionIdForStaff(supabase, result.registration_id);
    if (editionId) invalidateCache([{ type: "CapacityChanged", editionId }]);
    return { data: result };
  },
);
