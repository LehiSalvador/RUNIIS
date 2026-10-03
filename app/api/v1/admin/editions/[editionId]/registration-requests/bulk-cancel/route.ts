import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema } from "@/lib/server/domain/closure/contracts";
import { staffBulkCancelRegistrationRequests } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";
import { bulkCancelRequestsBodySchema } from "@/lib/shared/registration";

// OD-P2-01 measure 3. POST /api/v1/admin/editions/{editionId}/registration-requests/bulk-cancel (ADMIN, OPERATOR; Edition scope, SEC-020).
// Explicit ids (<= 100) + one internal reason; each id goes through the single-request staff cancel transition; per-id outcomes are
// returned (200 even when some are rejected); idempotent per (actor, Idempotency-Key); audited per request plus one batch record.
// Capacity is released by the request status (holds/claims RELEASED): there is no counter. CONFIRMED registrations are never touched.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: bulkCancelRequestsBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => {
    const result = await staffBulkCancelRegistrationRequests(supabase, input.params.editionId, input.body, idempotency.key);
    if (result.canceled_count > 0) {
      invalidateCache([
        { type: "RegistrationRequestCanceled", editionId: result.edition_id },
        { type: "CapacityChanged", editionId: result.edition_id },
      ]);
    }
    return { data: result };
  },
);
