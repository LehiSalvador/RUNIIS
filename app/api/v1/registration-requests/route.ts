import { createRegistrationRequestBodySchema } from "@/lib/shared/registration";
import { invalidateCache } from "@/lib/server/cache/invalidation";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

// POST /api/v1/registration-requests (Master §65-68). OD-P2-01: an EXTERNAL_WHATSAPP request from an account younger than 24 h answers
// 422 BUSINESS_RULE_VIOLATION {reason: "captcha_required" | "captcha_invalid", captcha: {challenge, ...}} until `altcha` carries the solved
// challenge; the rule itself lives in the database (no alternate path bypasses it). See createRegistrationRequest.
export const POST = defineRoute(
  { auth: "ready", input: { body: createRegistrationRequestBodySchema }, idempotency: "optional" },
  async ({ supabase, actor, input, idempotency }) => {
    const result = await createRegistrationRequest(supabase, input.body, idempotency?.key ?? null, { authUserId: actor.auth_user_id });
    invalidateCache([{ type: "RegistrationRequestCreated", editionId: result.edition.edition_id }]);
    return { data: result, status: 201 };
  },
);
