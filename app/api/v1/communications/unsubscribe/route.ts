import type { NextRequest } from "next/server";
import { AppError } from "@/lib/server/http/errors";
import { getClientIp } from "@/lib/server/http/client-ip";
import { consumeCommunicationRateLimit, unsubscribeWithToken } from "@/lib/server/domain/communications/service";

// POST /api/v1/communications/unsubscribe (SEC-084, RFC 8058 one-click). Deliberately NOT built on
// `defineRoute`: RFC 8058 mail clients POST a fixed `List-Unsubscribe=One-Click` body as
// `application/x-www-form-urlencoded` (sometimes with no body at all), which `defineRoute`'s
// JSON-only body parser would reject outright. The token travels in the query string (the
// `List-Unsubscribe` header URL the dispatcher builds already embeds it), never in a body we'd have
// to trust the mail client to send correctly.
export const runtime = "nodejs";

const TOKEN_PATTERN = /^[0-9a-f]{16,256}$/;

export async function POST(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_PATTERN.test(token)) return new Response(null, { status: 400 });

  try {
    await consumeCommunicationRateLimit("communication.unsubscribe.ip", getClientIp(request));
    await unsubscribeWithToken(token);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof AppError) {
      // Generic outcome regardless of reason (unknown/expired/already-used token): never an oracle.
      return new Response(null, { status: error.code === "RATE_LIMITED" ? 429 : error.code === "NOT_FOUND" ? 410 : 500 });
    }
    return new Response(null, { status: 500 });
  }
}
