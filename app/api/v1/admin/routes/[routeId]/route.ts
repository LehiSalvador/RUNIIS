import { routeIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { adminGetRoute } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; the Edition scope comes from the target Route (SEC-020).
export const GET = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: routeIdParamSchema } },
  async ({ supabase, input }) => ({ data: await adminGetRoute(supabase, input.params.routeId) }),
);
