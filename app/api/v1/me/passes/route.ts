import { listMyPasses } from "@/lib/server/domain/passes/service";
import { defineRoute } from "@/lib/server/http/handler";

export const GET = defineRoute({ auth: "ready" }, async ({ supabase }) => ({ data: await listMyPasses(supabase) }));
