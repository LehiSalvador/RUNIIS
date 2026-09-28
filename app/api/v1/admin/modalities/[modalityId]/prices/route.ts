import { invalidateCache } from "@/lib/server/cache/invalidation";
import { createPriceOfferBodySchema, modalityIdParamSchema } from "@/lib/server/domain/events/contracts";
import { createPriceOffer } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// PRICE_MANAGE. Overlapping ACTIVE windows are reported as warnings, not errors (Master §38).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: modalityIdParamSchema, body: createPriceOfferBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await createPriceOffer(supabase, input.params.modalityId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "PriceOfferChanged", editionId: result.price_offer.edition_id }]);
    return { data: result, status: 201 };
  },
);
