import { routeRevisionIdParamSchema, updateRevisionBodySchema } from "@/lib/server/domain/routes/contracts";
import { adminGetRouteRevision, updateRevision } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; the Edition scope comes from the target revision's Route (SEC-020).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: routeRevisionIdParamSchema } },
  async ({ supabase, input }) => ({ data: await adminGetRouteRevision(supabase, input.params.revisionId) }),
);

// PATCH: only a DRAFT revision may be edited (Master §48); geometry and/or pois, at least one.
export const PATCH = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: routeRevisionIdParamSchema, body: updateRevisionBodySchema } },
  async ({ supabase, input }) => ({ data: await updateRevision(supabase, input.params.revisionId, input.body) }),
);
