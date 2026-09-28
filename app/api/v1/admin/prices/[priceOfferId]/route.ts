import { priceOfferIdParamSchema, updatePriceOfferBodySchema } from "@/lib/server/domain/events/contracts";
import { updatePriceOffer } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// PRICE_MANAGE; an amount/currency already snapshotted by a request cannot change (create a new offer).
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: priceOfferIdParamSchema, body: updatePriceOfferBodySchema } },
  async ({ supabase, input }) => ({ data: await updatePriceOffer(supabase, input.params.priceOfferId, input.body) }),
);
