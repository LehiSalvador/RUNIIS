import { idParamsSchema } from "@/lib/server/domain/people/contracts";
import { respondFriendship } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute({ auth: "ready", input: { params: idParamsSchema } }, async ({ supabase, input }) => ({
  data: await respondFriendship(supabase, input.params.id, "reject"),
}));
