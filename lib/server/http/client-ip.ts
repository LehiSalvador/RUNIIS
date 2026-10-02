import "server-only";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { getServerEnv } from "../env";
import { logEvent } from "../log";

// SEC-141 / AUD-004: anonymous-endpoint rate limits key on the real client IP, never on a header the
// client can set. Which header is trustworthy depends on the edge in front of the app:
//  - Vercel: its edge sets/overwrites `x-vercel-forwarded-for`, `x-real-ip` and `x-forwarded-for`
//    with the connecting client's IP and does not forward external values
//    (https://vercel.com/docs/headers/request-headers). It does NOT strip `x-nf-client-connection-ip`,
//    so on Vercel that Netlify header is client-controlled and must be ignored.
//  - Netlify (coexistence period): its edge sets/overwrites `x-nf-client-connection-ip`; the
//    `x-forwarded-for` family is not an authority there and is ignored.
// The platform is detected from a server-side environment variable (`VERCEL` is injected by Vercel
// at build and run time); a client cannot influence it.
const NETLIFY_CLIENT_IP_HEADER = "x-nf-client-connection-ip";
const VERCEL_CLIENT_IP_HEADERS = ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"] as const;
const UNKNOWN_IP_SUBJECT = "unknown";

function trustedClientIpHeaders(): readonly string[] {
  return process.env.VERCEL ? VERCEL_CLIENT_IP_HEADERS : [NETLIFY_CLIENT_IP_HEADER];
}

/**
 * F4: a header value is only trusted when it is a syntactically valid single IP (`net.isIP`); a
 * client that supplies garbage -- or a comma-separated chain -- does not get a fresh spoofable
 * bucket. Outside local dev, a missing or invalid value never falls back to a single shared
 * "local-dev" subject (that would either give every real client the same generous local bucket, or
 * -- worse -- let a value that merely looks like "local-dev" be indistinguishable from the real local
 * fallback); it instead shares one strict, low-limit "unknown" bucket sized like any single IP's
 * quota, never its own fresh one.
 */
export function getClientIp(request: NextRequest): string {
  for (const name of trustedClientIpHeaders()) {
    const value = request.headers.get(name)?.trim();
    if (value && isIP(value)) return value;
  }

  const env = getServerEnv();
  if (env.APP_ENV === "local") return "local-dev";

  logEvent("warn", "client_ip_unavailable", { app_env: env.APP_ENV });
  return UNKNOWN_IP_SUBJECT;
}
