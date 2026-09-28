import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/server/env";

// Session refresh only (SEC-066): Server Components cannot write cookies, so a request that only
// renders pages would never persist a refreshed access token. This proxy refreshes it up front so
// every Server Component in the request sees a valid session. It is never the authorization
// boundary — every route handler and DB command re-checks the actor independently.
//
// It also issues the per-request CSP nonce (SEC-060/064) that authenticated/page responses carry;
// `next.config.ts` sets the header-only CSP for everything that does not need a nonce.
export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  const env = getServerEnv();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    // SEC-049: never JS-readable, matches lib/server/supabase/clients.ts.
    cookieOptions: { httpOnly: true, secure: env.APP_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set("Content-Security-Policy", csp);
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Verifies (and, if expired, refreshes) the session; never used for an authorization decision here.
  await supabase.auth.getClaims();

  return response;
}

function buildCsp(nonce: string): string {
  const cloudinaryCloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  // blob: is needed for client-rendered SVGs shown via an object URL (e.g. the pass QR view).
  const imgSrc = cloudinaryCloud ? "'self' data: blob: https://res.cloudinary.com" : "'self' data: blob:";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
