import { z } from "zod";
import { guardianRejectBodySchema } from "@/lib/server/domain/raceday/contracts";
import { guardianReject } from "@/lib/server/domain/raceday/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ registrationId: z.guid() });

// GUARDIAN_VERIFY (ADMIN, OPERATOR, CHECKIN).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR", "CHECKIN"] }, input: { params: paramsSchema, body: guardianRejectBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await guardianReject(supabase, input.params.registrationId, input.body.reason, idempotency?.key ?? null),
  }),
);
