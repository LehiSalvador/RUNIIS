import { invalidateCache } from "@/lib/server/cache/invalidation";
import { editionIdParamSchema, hideEditionBodySchema } from "@/lib/server/domain/events/contracts";
import { transitionEdition } from "@/lib/server/domain/events/service";
import { defineRoute } from "@/lib/server/http/handler";

// EDITION_PUBLISH (ADMIN only). Hiding removes the Edition from every public surface (search, home,
// sitemap, its own page/availability by slug — see 20260928110000_310_discovery_queries.sql's
// publication_state = 'PUBLISHED' guards), so it must invalidate the `editions` cache tag immediately
// (T31b-discovery-fixes F1-F5), the same way EditionCanceled/Postponed/Rescheduled already do.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN"], editionParam: "editionId" }, input: { params: editionIdParamSchema, body: hideEditionBodySchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await transitionEdition(supabase, "hide", input.params.editionId, input.body, idempotency?.key ?? null);
    invalidateCache([{ type: "EditionHidden", editionId: input.params.editionId }]);
    return { data: result };
  },
);
