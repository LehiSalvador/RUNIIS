import { createRegistrationRequestBodySchema } from "@/lib/shared/registration";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute(
  { auth: "ready", input: { body: createRegistrationRequestBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await createRegistrationRequest(supabase, input.body, idempotency?.key ?? null),
    status: 201,
  }),
);
