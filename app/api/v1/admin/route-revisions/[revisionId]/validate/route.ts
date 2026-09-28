import { routeRevisionIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { validateRevision } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; Master §50/§170. Recomputes and persists validation_result; only a DRAFT
// revision may be validated. Warnings never block; blocking errors do (checked again on publish).
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: routeRevisionIdParamSchema } },
  async ({ supabase, input }) => ({ data: await validateRevision(supabase, input.params.revisionId) }),
);
