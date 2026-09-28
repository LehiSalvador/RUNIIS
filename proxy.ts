import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv, isSecureAppBaseUrl } from "@/lib/server/env";

const CSP_REPORT_ENDPOINT_NAME = "csp-endpoint";
const CSP_REPORT_PATH = "/api/csp-report";

// SEC-064: pages that carry a single-use, capability-bearing query string must never leak it to a
// third-party Referer target via a same-origin-then-offsite navigation chain.
const NO_REFERRER_PATHS = ["/auth/callback", "/recordatorios/confirmar"];

// Session refresh only (SEC-066): Server Components cannot write cookies, so a request that only
// renders pages would never persist a refreshed access token. This proxy refreshes it up front so
// every Server Component in the request sees a valid session. It is never the authorization
// boundary — every route handler and DB command re-checks the actor independently.
//
// It also sets the CSP (SEC-060/064): a per-request nonce policy for session surfaces, and a
// nonce-free policy for the cached public pages (buildPublicCsp below).
export async function proxy(request: NextRequest) {
  const env = getServerEnv();
  const pathname = request.nextUrl.pathname;
  const reportUrl = new URL(CSP_REPORT_PATH, env.APP_BASE_URL).toString();

  const requestHeaders = new Headers(request.headers);
  let csp: string;
  if (isCachedPublicPath(pathname)) {
    csp = buildPublicCsp(reportUrl);
  } else {
    const nonce = crypto.randomUUID().replace(/-/g, "");
    csp = buildCsp(nonce, reportUrl);
    requestHeaders.set("x-nonce", nonce);
  }
  const referrerPolicy = isNoReferrerPath(pathname) ? "no-referrer" : null;

  const applySecurityHeaders = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("Reporting-Endpoints", `${CSP_REPORT_ENDPOINT_NAME}="${reportUrl}"`);
    if (referrerPolicy) res.headers.set("Referrer-Policy", referrerPolicy);
    return res;
  };

  let response = applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    // SEC-049/F6: never JS-readable, matches lib/server/supabase/clients.ts.
    cookieOptions: { httpOnly: true, secure: isSecureAppBaseUrl(env), sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
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
// style/tiles/glyphs (connect-src) and its blob: web worker. Everything behind a session, and
// anything not on this explicit allowlist, keeps the nonce + strict-dynamic policy (F7: fail
// closed on an unrecognised path rather than fail open).
const PUBLIC_EXACT_PATHS = new Set(["/", "/eventos", "/runiis", "/contacto", "/robots.txt", "/sitemap.xml"]);
const PUBLIC_PATH_PREFIXES = ["/eventos/", "/legal/", "/vendor/maplibre/"];
const PUBLIC_OG_PATH = "/og";
const STATIC_ASSET_RE = /\.(?:svg|png|jpe?g|gif|webp|ico|css|js|map|woff2?|ttf)$/;
const MAP_TILE_ORIGIN = "https://tiles.openfreemap.org";
// React needs eval() for dev-only debugging features; production never uses it.
const DEV_EVAL = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

/** Lower-cases, percent-decodes and collapses repeated slashes so case/encoding variants and
 * `//host`-style protocol-relative tricks cannot dodge the allowlist (F7). Malformed percent
 * escapes fail closed (never treated as public). */
export function normalizePath(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "\u0000invalid";
  }
  decoded = decoded.toLowerCase().replace(/\/{2,}/g, "/");
  if (decoded.length > 1 && decoded.endsWith("/")) decoded = decoded.slice(0, -1);
  return decoded || "/";
}

export function isCachedPublicPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (PUBLIC_EXACT_PATHS.has(path)) return true;
  if (path === PUBLIC_OG_PATH || path.startsWith(`${PUBLIC_OG_PATH}/`)) return true;
  if (PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return STATIC_ASSET_RE.test(path);
}

export function isNoReferrerPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return NO_REFERRER_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

function imgSrc(): string {
  // blob: is needed for client-rendered SVGs shown via an object URL (e.g. the pass QR view).
  return process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ? "'self' data: blob: https://res.cloudinary.com" : "'self' data: blob:";
}

function reportingDirectives(reportUrl: string): string[] {
  // report-to (CSP3, Reporting API) plus the legacy report-uri fallback for browsers/versions that
  // do not yet honour Reporting-Endpoints (F7/SEC-060).
  return [`report-to ${CSP_REPORT_ENDPOINT_NAME}`, `report-uri ${reportUrl}`];
}

export function buildPublicCsp(reportUrl: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${DEV_EVAL}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc()}`,
    "font-src 'self'",
    `connect-src 'self' ${MAP_TILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    ...reportingDirectives(reportUrl),
  ].join("; ");
}

function buildCsp(nonce: string, reportUrl: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV_EVAL}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc()}`,
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    ...reportingDirectives(reportUrl),
  ].join("; ");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
