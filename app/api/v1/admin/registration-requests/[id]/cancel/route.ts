import { z } from "zod";
import { invalidateCache } from "@/lib/server/cache/invalidation";
import { staffCancelBodySchema } from "@/lib/server/domain/registration/contracts";
import { staffCancelRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ id: z.guid() });

export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: paramsSchema, body: staffCancelBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await staffCancelRegistrationRequest(supabase, input.params.id, input.body.reason, idempotency?.key ?? null);
    invalidateCache([{ type: "RegistrationRequestCanceled", editionId: result.edition.edition_id }]);
    return { data: result };
  },
);
