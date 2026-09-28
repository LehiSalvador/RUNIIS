import { createRegistrationRequestBodySchema } from "@/lib/shared/registration";
import { invalidateCache } from "@/lib/server/cache/invalidation";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute(
  { auth: "ready", input: { body: createRegistrationRequestBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await createRegistrationRequest(supabase, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "RegistrationRequestCreated", editionId: result.edition.edition_id }]);
    return { data: result, status: 201 };
  },
);
