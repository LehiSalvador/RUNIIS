import { z } from "zod";
import { getMyPass } from "@/lib/server/domain/passes/service";
import { defineRoute } from "@/lib/server/http/handler";

const paramsSchema = z.strictObject({ passId: z.guid() });

export const GET = defineRoute({ auth: "ready", input: { params: paramsSchema } }, async ({ supabase, input }) => ({
  data: await getMyPass(supabase, input.params.passId),
}));
