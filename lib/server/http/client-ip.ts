import "server-only";
import type { NextRequest } from "next/server";

// SEC-141: anonymous-endpoint rate limits key on the real client IP, never a client-supplied
// X-Forwarded-For (trivially spoofable). Netlify terminates TLS and sets this header itself.
const NETLIFY_CLIENT_IP_HEADER = "x-nf-client-connection-ip";

export function getClientIp(request: NextRequest): string {
  const netlifyIp = request.headers.get(NETLIFY_CLIENT_IP_HEADER);
  if (netlifyIp) return netlifyIp.trim();
  // Local dev has no Netlify edge in front of it; fall back to a fixed subject so rate limits
  // still function (shared across local clients, which is acceptable outside production).
  return "local-dev";
}
