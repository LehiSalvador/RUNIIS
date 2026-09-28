import { invalidateCache } from "@/lib/server/cache/invalidation";
import { cancelRequestBodySchema, requestCursorParamSchema } from "@/lib/server/domain/registration/contracts";
import { cancelRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute(
  { auth: "ready", input: { params: requestCursorParamSchema, body: cancelRequestBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await cancelRegistrationRequest(supabase, input.params.id, input.body.reason, idempotency?.key ?? null);
    invalidateCache([{ type: "RegistrationRequestCanceled", editionId: result.edition.edition_id }]);
    return { data: result };
  },
);
