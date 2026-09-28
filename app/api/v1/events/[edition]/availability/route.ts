import { editionSlugParamSchema } from "@/lib/server/domain/discovery/contracts";
import { getEditionAvailability } from "@/lib/server/domain/discovery/service";
import { AppError } from "@/lib/server/http/errors";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/events/:slug/availability (Master §60: availability reads fresh, never cached —
// SEC-051/052). Explicit no-store on top of defineRoute's default (public routes get no forced
// Cache-Control otherwise) so no shared/CDN cache ever serves a stale capacity snapshot.
export const GET = defineRoute({ auth: "public", input: { params: editionSlugParamSchema } }, async ({ input }) => {
  const availability = await getEditionAvailability(input.params.edition);
  if (!availability) throw new AppError("NOT_FOUND");
  return { data: availability, headers: { "Cache-Control": "no-store" } };
});
