import { listMyFavorites } from "@/lib/server/domain/communications/service";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/me/favorites (Master §127-129, §176).
export const GET = defineRoute({ auth: "authenticated" }, async ({ supabase }) => {
  return { data: await listMyFavorites(supabase) };
});
