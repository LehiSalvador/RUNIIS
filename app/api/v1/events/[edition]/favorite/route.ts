import { addEditionFavorite, removeEditionFavorite } from "@/lib/server/domain/communications/service";
import { editionIdParamSchema } from "@/lib/server/domain/communications/contracts";
import { defineRoute } from "@/lib/server/http/handler";

// POST/DELETE /api/v1/events/:editionId/favorite (Master §127-129, §176). Unlike T31's sibling GET
// routes under the same [edition] segment, T35 treats `edition` as the Edition id, not the slug
// (favoriting/reminders are id-addressed like every other authenticated command).
export const POST = defineRoute({ auth: "authenticated", input: { params: editionIdParamSchema } }, async ({ supabase, input }) => {
  return { data: await addEditionFavorite(supabase, input.params.edition) };
});

export const DELETE = defineRoute({ auth: "authenticated", input: { params: editionIdParamSchema } }, async ({ supabase, input }) => {
  return { data: await removeEditionFavorite(supabase, input.params.edition) };
});
