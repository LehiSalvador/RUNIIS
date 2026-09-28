import { z } from "zod";
import { formIdParamSchema } from "@/lib/server/domain/events/contracts";
import { publishRegistrationForm } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE. Publishing supersedes the previous PUBLISHED version of the same scope.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: formIdParamSchema, body: z.strictObject({}) }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({ data: await publishRegistrationForm(supabase, input.params.formId, idempotency?.key ?? null) }),
);
