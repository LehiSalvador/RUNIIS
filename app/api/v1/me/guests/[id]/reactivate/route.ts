import { idParamsSchema } from "@/lib/server/domain/people/contracts";
import { reactivateGuest } from "@/lib/server/domain/people/service";
import { defineRoute } from "@/lib/server/http/handler";

export const POST = defineRoute({ auth: "ready", input: { params: idParamsSchema } }, async ({ supabase, input }) => ({
  data: await reactivateGuest(supabase, input.params.id),
}));
