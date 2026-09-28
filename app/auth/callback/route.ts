import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { resolveNextPath } from "@/lib/server/auth/safe-redirect";
import { logEvent } from "@/lib/server/log";
import { createSessionClient } from "@/lib/server/supabase/clients";

// PKCE callback for the Google OAuth flow (ADR-001 A8; disabled locally, wired for when it is
// enabled). The OTP flow never redirects here -- it is a JSON API (/api/v1/auth/otp, /verify).
// `next` is resolved through the internal allowlist (SEC-044) before it is ever used as a redirect.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = resolveNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/entrar?error=missing_code`);
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logEvent("warn", "oauth_callback_exchange_failed", { reason: error.name });
    return NextResponse.redirect(`${origin}/entrar?error=auth_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
