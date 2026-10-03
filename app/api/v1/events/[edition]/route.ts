import { editionSlugParamSchema } from "@/lib/server/domain/discovery/contracts";
import { mapCta } from "@/lib/server/domain/discovery/cta";
import { getEditionPage } from "@/lib/server/domain/discovery/service";
import { AppError } from "@/lib/server/http/errors";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/events/:slug (Master §58-59, §165): the `edition` segment is the Edition SLUG for
// every route T31 owns under this folder (T35 later adds sibling mutation routes under the same
// [edition] segment name that instead treat it as an Edition id — see .local-state/task-state).
// A historical slug (Master §59 "cambio de slug conserva redirect permanente") gets a real 308 here
// so non-RSC API consumers follow it automatically; the getEditionPage() server function itself
// just returns {redirect:true, slug} and lets its own caller (an RSC page) decide how to redirect.
export const GET = defineRoute({ auth: "public", input: { params: editionSlugParamSchema } }, async ({ request, input }) => {
  const result = await getEditionPage(input.params.edition);
  if (!result) throw new AppError("NOT_FOUND");
  if (result.redirect) {
    // Not Response.redirect(): its headers are immutable and defineRoute adds x-request-id (it would answer 500).
    const location = new URL(`/api/v1/events/${result.slug}`, request.nextUrl).toString();
    return new Response(null, { status: 308, headers: { Location: location } });
  }
  const page = result.edition;
  return {
    data: { ...page, cta: mapCta(page.edition.registration_state, page.edition.execution_state, page.availability?.global_state ?? null) },
  };
});
