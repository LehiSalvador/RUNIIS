import { invalidateCache } from "@/lib/server/cache/invalidation";
import { registrationIdParamSchema } from "@/lib/server/domain/closure/contracts";
import { cancelConfirmedRegistration, registrationEditionIdForStaff } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";
import { cancelRegistrationBodySchema } from "@/lib/shared/closure";

// Master §77, §172, OWN-04. REGISTRATION_MANAGE (ADMIN, OPERATOR); the Edition scope comes from the target registration
// (SEC-020). Allowed on a CONFIRMED registration until attendance is finalized; afterwards 422 CLOSURE_BLOCKED (reopen first).
// Frees capacity, cancels the pass, reviews the kit, reverses an active credit and emails the participant (the buyer for a
// Guest) through the outbox: the email carries `reason_category` only, never the free-text `reason`.
// P3SECA-06: the response also carries `notification: { status: queued | suppressed | no_contact | unknown, follow_up_task_id }`; for
// suppressed / no_contact an ACTION_REQUIRED task (`registration-cancel-notice:{registration}`) is open for staff follow-up (OWN-04 still always notifies).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: registrationIdParamSchema, body: cancelRegistrationBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await cancelConfirmedRegistration(supabase, input.params.id, input.body, idempotency.key);
    // Freed capacity changes the public availability projection.
    const editionId = await registrationEditionIdForStaff(supabase, result.registration_id);
    if (editionId) invalidateCache([{ type: "CapacityChanged", editionId }]);
    return { data: result };
  },
);
