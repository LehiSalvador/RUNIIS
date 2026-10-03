import { editionIdParamSchema, reopenWithReasonBodySchema } from "@/lib/server/domain/closure/contracts";
import { reopenEdition } from "@/lib/server/domain/closure/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §98, §175. EDITION_CLOSURE_MANAGE (ADMIN only), reason mandatory. Reverses every ACTIVE DistanceCredit of the
// Edition (history is kept: a later close links its new credit to the reversed one) and returns closure_state to PENDING.
// The attendance finalization stays current; reopen it separately to correct attendance.
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN"], editionParam: "editionId" },
    input: { params: editionIdParamSchema, body: reopenWithReasonBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await reopenEdition(supabase, input.params.editionId, input.body.reason, idempotency.key),
  }),
);
