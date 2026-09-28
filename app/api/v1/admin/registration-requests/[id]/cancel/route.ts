import { z } from "zod";
import { staffCancelBodySchema } from "@/lib/server/domain/registration/contracts";
import { staffCancelRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ id: z.guid() });

export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: paramsSchema, body: staffCancelBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => ({
    data: await staffCancelRegistrationRequest(supabase, input.params.id, input.body.reason, idempotency?.key ?? null),
  }),
);
