import { pendingActionsQuerySchema } from "@/lib/server/domain/registration/contracts";
import { listMyPendingActions } from "@/lib/server/domain/registration/service";
import { defineRoute } from "@/lib/server/http/handler";

export const GET = defineRoute({ auth: "ready", input: { query: pendingActionsQuerySchema } }, async ({ supabase, input }) => ({
  data: (await listMyPendingActions(supabase, input.query.edition_id)).items,
}));
