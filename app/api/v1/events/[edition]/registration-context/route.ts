import { editionSlugParamSchema } from "@/lib/server/domain/discovery/contracts";
import { getRegistrationContext } from "@/lib/server/domain/registration/service";
import { AppError } from "@/lib/server/http/errors";
import { defineRoute } from "@/lib/server/http/handler";

// GET /api/v1/events/:slug/registration-context (P2-B): the `edition` segment is the Edition SLUG, like every
// route T31 owns under this folder. Auth "ready" (signed in with a READY profile): the read model is about the
// signed-in buyer. Authorization is in the database (definer command, buyer = auth.uid()); only PUBLISHED
// editions resolve (unknown/draft/hidden = 404, no oracle). A historical slug answers 308 to the current one.
// Rate limited (registration.context, 120/10 min/user); read-only (no idempotency, no audit); never cached.
export const GET = defineRoute({ auth: "ready", input: { params: editionSlugParamSchema } }, async ({ request, supabase, input }) => {
  const result = await getRegistrationContext(supabase, input.params.edition);
  if (!result) throw new AppError("NOT_FOUND");
  if (result.redirect) {
    // Not Response.redirect(): its headers are immutable and the route wrapper adds x-request-id/Cache-Control.
    const location = new URL(`/api/v1/events/${result.slug}/registration-context`, request.nextUrl).toString();
    return new Response(null, { status: 308, headers: { Location: location } });
  }
  return { data: result.context, headers: { "Cache-Control": "private, no-store" } };
});
