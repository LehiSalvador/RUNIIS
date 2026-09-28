import { requestCursorParamSchema } from "@/lib/server/domain/registration/contracts";
import { getRegistrationRequest } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

export const GET = defineRoute({ auth: "ready", input: { params: requestCursorParamSchema } }, async ({ supabase, input }) => ({
  data: await getRegistrationRequest(supabase, input.params.id),
}));
