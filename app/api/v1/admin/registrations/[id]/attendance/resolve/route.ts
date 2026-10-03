import type { JsonObject } from "@/lib/shared/api-contract";
import { registrationIdParamSchema, resolveAttendanceBodySchema } from "@/lib/server/domain/closure/contracts";
import { resolveAttendance } from "@/lib/server/domain/closure/service";
import { defineRoute } from "@/lib/server/http/handler";

// Master §91, §175. ATTENDANCE_MANAGE (ADMIN, OPERATOR); the Edition scope comes from the target registration (SEC-020).
// PRESENT needs reason + evidence_metadata, EXCLUDED needs reason; a settled row is changed as a CORRECTION revision.
// Refused with 422 CLOSURE_BLOCKED once attendance is finalized (reopen the finalization first).
export const POST = defineRoute(
  {
    auth: { staff: ["ADMIN", "OPERATOR"] },
    input: { params: registrationIdParamSchema, body: resolveAttendanceBodySchema },
    idempotency: "required",
  },
  async ({ supabase, input, idempotency }) => ({
    data: await resolveAttendance(
      supabase,
      input.params.id,
      { ...input.body, evidence_metadata: input.body.evidence_metadata as JsonObject | undefined },
      idempotency.key,
    ),
  }),
);
