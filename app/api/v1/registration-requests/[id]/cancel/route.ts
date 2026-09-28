import { cancelRequestBodySchema, requestCursorParamSchema } from "@/lib/server/domain/registration/contracts";
import { cancelRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute(
  { auth: "ready", input: { params: requestCursorParamSchema, body: cancelRequestBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await cancelRegistrationRequest(supabase, input.params.id, input.body.reason, idempotency?.key ?? null),
  }),
);
