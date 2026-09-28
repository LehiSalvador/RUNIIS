import { NextResponse } from "next/server";
import { z } from "zod";
import { isGoogleSignInEnabled } from "@/app/entrar/_lib/google";
import { resolveNextPath } from "@/lib/server/auth/safe-redirect";
import { getServerEnv } from "@/lib/server/env";
import { defineRoute } from "@/lib/server/http/handler";
import { logEvent } from "@/lib/server/log";
import { createSessionClient } from "@/lib/server/supabase/clients";

const querySchema = z.object({ next: z.string().max(2048).optional() });

// Google OAuth start (ADR-001 A8): PKCE via the cookie-bound client, so the code verifier lands in an
// HttpOnly cookie on this redirect and /auth/callback exchanges it. `next` goes through the same
// SEC-044 allowlist as the callback before it is embedded in redirectTo. Failures land on /entrar.
export const GET = defineRoute({ auth: "public", input: { query: querySchema } }, async ({ input }) => {
  const baseUrl = new URL(getServerEnv().APP_BASE_URL).origin;
  const next = resolveNextPath(input.query.next ?? null);
  const fail = (code: string) => noStore(NextResponse.redirect(`${baseUrl}/entrar?error=${code}`, 303));

  if (!(await isGoogleSignInEnabled())) return fail("google_unavailable");

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${baseUrl}/auth/callback?next=${encodeURIComponent(next)}`, skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    logEvent("warn", "oauth_start_failed", { reason: error?.name ?? "missing_url" });
    return fail("auth_failed");
  }
  return noStore(NextResponse.redirect(data.url, 303));
});

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
