import { z } from "zod";
import { invalidateCache } from "@/lib/server/cache/invalidation";
import { revalidateConfirmBodySchema } from "@/lib/server/domain/registration/contracts";
import { revalidateAndConfirmRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ id: z.guid() });

export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: paramsSchema, body: revalidateConfirmBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await revalidateAndConfirmRegistrationRequest(supabase, input.params.id, input.body.expected_total_minor, idempotency?.key ?? null);
    invalidateCache([{ type: "RegistrationConfirmed", editionId: result.edition.edition_id }]);
    return { data: result };
  },
);
