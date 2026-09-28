import { invalidateCache } from "@/lib/server/cache/invalidation";
import { routeRevisionIdParamSchema } from "@/lib/server/domain/routes/contracts";
import { publishRevision } from "@/lib/server/domain/routes/service";
import { defineRoute } from "@/lib/server/http/handler";

// EVENT_CONTENT_MANAGE; Master §46/§50/§151/§170. Requires no blocking validation errors; supersedes
// the route's previous PUBLISHED revision (one PUBLISHED per route, enforced by a DB partial unique
// index). Emits RoutePublished (outbox) and invalidates the Edition cache tag.
export const POST = defineRoute(
  { auth: { staff: ["ADMIN", "OPERATOR"] }, input: { params: routeRevisionIdParamSchema }, idempotency: "optional" },
  async ({ supabase, input, idempotency }) => {
    const result = await publishRevision(supabase, input.params.revisionId, idempotency?.key ?? null);
    invalidateCache([{ type: "RoutePublished", editionId: result.edition_id }]);
    return { data: result };
  },
);
