import { idParamsSchema } from "@/lib/server/domain/people/contracts";
import { removeFriendship } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const DELETE = defineRoute({ auth: "ready", input: { params: idParamsSchema } }, async ({ supabase, input }) => ({
  data: await removeFriendship(supabase, input.params.id),
}));
