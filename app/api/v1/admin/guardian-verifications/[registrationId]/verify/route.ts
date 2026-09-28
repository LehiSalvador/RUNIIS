import { z } from "zod";
import { guardianVerifyBodySchema } from "@/lib/server/domain/raceday/contracts";
import { guardianVerify } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ registrationId: z.guid() });

// GUARDIAN_VERIFY (ADMIN, OPERATOR, CHECKIN). Master §21: a minor cannot complete EVENT_CHECKIN without
// this. The DB derives the Edition scope from the target registration (SEC-020).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] }, input: { params: paramsSchema, body: guardianVerifyBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await guardianVerify(supabase, input.params.registrationId, input.body.verification_method, input.body.notes ?? null, idempotency?.key ?? null),
  }),
);
