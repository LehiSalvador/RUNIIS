import { z } from "zod";
import { guardianVerifyBodySchema } from "@/lib/server/domain/raceday/contracts";
import { guardianVerify } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ registrationId: z.guid() });

// GUARDIAN_VERIFY (ADMIN, OPERATOR, CHECKIN). Master §21: a minor cannot complete EVENT_CHECKIN without
// this. The DB derives the Edition scope from the target registration (SEC-020).
// actorRateLimit: false -- the race-day desk keeps its own raceday.* limiter (P3SECA-03); the shared staff pre-check must not throttle the desk.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] }, input: { params: paramsSchema, body: guardianVerifyBodySchema }, idempotency: "optional", actorRateLimit: false },
  async ({ supabase, input, idempotency }) => ({
    data: await guardianVerify(supabase, input.params.registrationId, input.body.verification_method, input.body.notes ?? null, idempotency?.key ?? null),
  }),
);
