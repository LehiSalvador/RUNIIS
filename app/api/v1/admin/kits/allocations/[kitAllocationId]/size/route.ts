import { z } from "zod";
import { kitAllocationSizeBodySchema } from "@/lib/server/domain/raceday/contracts";
import { changeKitAllocationSize } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ kitAllocationId: z.guid() });

// KIT_MANAGE (ADMIN, OPERATOR). Validates the new variant's availability before applying (Master §88).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: paramsSchema, body: kitAllocationSizeBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await changeKitAllocationSize(supabase, input.params.kitAllocationId, input.body.new_kit_variant_id, input.body.reason, idempotency?.key ?? null),
  }),
);
