import { z } from "zod";
import { kitPickupReverseBodySchema } from "@/lib/server/domain/raceday/contracts";
import { reverseKitPickup } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ kitPickupId: z.guid() });

// KIT_MANAGE (ADMIN, OPERATOR only -- CHECKIN records pickups but cannot reverse them). The DB derives
// the Edition scope from the target pickup (SEC-020).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: paramsSchema, body: kitPickupReverseBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await reverseKitPickup(supabase, input.params.kitPickupId, input.body.reason, idempotency?.key ?? null),
  }),
);
