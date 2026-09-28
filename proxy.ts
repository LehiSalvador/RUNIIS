import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/server/env";

// Session refresh only (SEC-066): Server Components cannot write cookies, so a request that only
// renders pages would never persist a refreshed access token. This proxy refreshes it up front so
// every Server Component in the request sees a valid session. It is never the authorization
// boundary — every route handler and DB command re-checks the actor independently.
//
// It also sets the CSP (SEC-060/064): a per-request nonce policy for session surfaces, and a
// nonce-free policy for the cached public pages (buildPublicCsp below).
export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  let csp: string;
  if (isCachedPublicPath(request.nextUrl.pathname)) {
    csp = buildPublicCsp();
  } else {
    const nonce = crypto.randomUUID().replace(/-/g, "");
    csp = buildCsp(nonce);
    requestHeaders.set("x-nonce", nonce);
  }

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

// SEC-060: the public surfaces (Home, /eventos, Event pages, /runiis, /contacto, /legal) are
// static/ISR HTML shared by every visitor, so they cannot carry a per-request nonce -- a nonce CSP
// there blocks every prerendered Next script. They get a nonce-free policy that allows only the
// inline bootstrap Next emits, plus the MapLibre needs of the Event page route map: the OpenFreeMap
// style/tiles/glyphs (connect-src) and its blob: web worker. Everything behind a session keeps the
// nonce + strict-dynamic policy.
const NONCE_PREFIXES = ["/admin", "/cuenta", "/scanner", "/inscripcion", "/entrar", "/onboarding", "/auth", "/api", "/design-system"];
const MAP_TILE_ORIGIN = "https://tiles.openfreemap.org";
// React needs eval() for dev-only debugging features; production never uses it.
const DEV_EVAL = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

export function isCachedPublicPath(pathname: string): boolean {
  return !NONCE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function imgSrc(): string {
  // blob: is needed for client-rendered SVGs shown via an object URL (e.g. the pass QR view).
  return process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ? "'self' data: blob: https://res.cloudinary.com" : "'self' data: blob:";
}

export function buildPublicCsp(): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${DEV_EVAL}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc()}`,
    "font-src 'self'",
    `connect-src 'self' ${MAP_TILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV_EVAL}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc()}`,
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
