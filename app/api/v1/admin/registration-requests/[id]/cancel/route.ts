import { z } from "zod";
import { invalidateCache } from "@/lib/server/cache/invalidation";
import { staffCancelBodySchema } from "@/lib/server/domain/registration/contracts";
import { staffCancelRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ id: z.guid() });

// P3-S (UX J2 step 4): staff cancel of a PENDING/EXPIRED request notifies the BUYER by email through the outbox (one per request; the buyer's own cancel
// and the worker's expiry send nothing). The email shows only the closed `reason_category` label (optional, default OTHER), never the free-text `reason`.
// The response carries the previous view plus `notification: { status: queued | suppressed | no_contact | unknown, follow_up_task_id }`; for suppressed /
// no_contact an ACTION_REQUIRED task (`registration-request-cancel-notice:{request}`) is open for staff follow-up.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: paramsSchema, body: staffCancelBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await staffCancelRegistrationRequest(supabase, input.params.id, input.body.reason, idempotency?.key ?? null, input.body.reason_category);
    invalidateCache([{ type: "RegistrationRequestCanceled", editionId: result.edition.edition_id }]);
    return { data: result };
  },
);
