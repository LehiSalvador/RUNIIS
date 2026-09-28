import type { NextRequest } from "next/server";
import { getServerEnv } from "@/lib/server/env";
import { getClientIp } from "@/lib/server/http/client-ip";
import { AppError, toAppError } from "@/lib/server/http/errors";
import { logEvent } from "@/lib/server/log";
import { consumeCommunicationRateLimit, recordEmailProviderEvent } from "@/lib/server/domain/communications/service";
import { BREVO_WEBHOOK_MAX_BODY_BYTES, isAuthorizedBrevoWebhook, parseBrevoWebhookEvent, WebhookPayloadError } from "@/lib/server/domain/communications/webhook";

// Inbound Brevo webhook (Master §138, SEC-080): deliberately NOT built on `defineRoute` — no session,
// no CSRF-relevant origin check (server-to-server), and the body must be size-capped and read before
// any JSON parsing is attempted, regardless of whether the secret header checks out.
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await readBodyWithCap(request, BREVO_WEBHOOK_MAX_BODY_BYTES);
  if (rawBody === null) return new Response(null, { status: 413 });

  const secret = getServerEnv().BREVO_WEBHOOK_AUTH_SECRET;
  const authenticated = isAuthorizedBrevoWebhook(request.headers, secret);

  if (!authenticated) {
    try {
      await consumeCommunicationRateLimit("webhook.email.unauthenticated.ip", getClientIp(request));
    } catch (error) {
      if (error instanceof AppError && error.code === "RATE_LIMITED") return new Response(null, { status: 429 });
      throw error;
    }
    // Evidence only: recorded but never applied to message/consent state (SEC-080).
    try {
      await recordEmailProviderEvent(parseBrevoWebhookEvent(rawBody, false));
    } catch (error) {
      if (!(error instanceof WebhookPayloadError)) logEvent("warn", "brevo_webhook_unauthenticated_record_failed", { error_name: toAppError(error).code });
    }
    const response = new Response(null, { status: 401 });
    response.headers.set("WWW-Authenticate", `Secret realm="brevo-webhook"`);
    return response;
  }

  let args: ReturnType<typeof parseBrevoWebhookEvent>;
  try {
    args = parseBrevoWebhookEvent(rawBody, true);
  } catch {
    return new Response(null, { status: 400 });
  }

  try {
    await recordEmailProviderEvent(args);
  } catch (error) {
    logEvent("error", "brevo_webhook_record_failed", { error_code: toAppError(error).code });
    return new Response(null, { status: 502 });
  }
  return new Response(null, { status: 204 });
}

/** Streams the body with a hard byte cap; returns null when the declared or actual size exceeds it. */
async function readBodyWithCap(request: NextRequest, maxBytes: number): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}
