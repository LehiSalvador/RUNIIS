import "server-only";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { getServerEnv } from "../env";
import { logEvent } from "../log";

// SEC-141: anonymous-endpoint rate limits key on the real client IP, never a client-supplied
// X-Forwarded-For (trivially spoofable). Netlify's edge sets/overwrites this header itself before
// the request reaches the app -- an assumption carried from the platform docs, not independently
// verified against a live edge in this batch (F4).
const NETLIFY_CLIENT_IP_HEADER = "x-nf-client-connection-ip";
const UNKNOWN_IP_SUBJECT = "unknown";

/**
 * F4: the header value is only trusted when it is a syntactically valid IP (`net.isIP`); a client
 * that supplies garbage does not get a fresh spoofable bucket. Outside local dev, a missing or
 * invalid header never falls back to a single shared "local-dev" subject (that would either give
 * every real client the same generous local bucket, or -- worse -- let a value that merely looks
 * like "local-dev" be indistinguishable from the real local fallback); it instead shares one
 * strict, low-limit "unknown" bucket sized like any single IP's quota, never its own fresh one.
 */
export function getClientIp(request: NextRequest): string {
  const header = request.headers.get(NETLIFY_CLIENT_IP_HEADER)?.trim();
  if (header && isIP(header)) return header;

  const env = getServerEnv();
  if (env.APP_ENV === "local") return "local-dev";

  logEvent("warn", "client_ip_unavailable", { app_env: env.APP_ENV });
  return UNKNOWN_IP_SUBJECT;
}
