import { z } from "zod";
import { replaceCredentialBodySchema } from "@/lib/server/domain/registration/contracts";
import { replacePassCredential } from "@/lib/server/domain/passes/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ passId: z.guid() });

// PASS_CREDENTIAL_REPLACE (ADMIN, OPERATOR); the DB derives the Edition scope from the target pass (SEC-020).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: paramsSchema, body: replaceCredentialBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await replacePassCredential(supabase, input.params.passId, input.body.reason, idempotency?.key ?? null),
  }),
);
