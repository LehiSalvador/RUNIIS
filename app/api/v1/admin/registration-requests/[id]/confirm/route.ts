import { z } from "zod";
import { invalidateCache } from "@/lib/server/cache/invalidation";
import { confirmRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ id: z.guid() });

// REGISTRATION_REQUEST_MANAGE (ADMIN, OPERATOR); the Edition scope comes from the target request (SEC-020).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: paramsSchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await confirmRegistrationRequest(supabase, input.params.id, idempotency?.key ?? null);
    invalidateCache([{ type: "RegistrationConfirmed", editionId: result.edition.edition_id }]);
    return { data: result };
  },
);
