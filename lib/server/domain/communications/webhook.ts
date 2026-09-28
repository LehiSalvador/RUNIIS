import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Brevo transactional webhooks carry no built-in HMAC signature; the recommended, and only, way to
// authenticate them is a static secret Brevo echoes back verbatim on a header configured when the
// webhook endpoint is registered (a privileged Brevo dashboard/API operation — see the T35 handoff
// decision on the exact header name and value to configure). SEC-080: unauthenticated deliveries are
// recorded as evidence only and never change any message/consent state.
export const BREVO_WEBHOOK_SECRET_HEADER = "x-runiis-brevo-secret";
export const BREVO_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

/** Constant-time secret-header check, same construction as the internal worker auth (SEC-006). */
export function isAuthorizedBrevoWebhook(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return false;
  const presented = headers.get(BREVO_WEBHOOK_SECRET_HEADER) ?? "";
  if (presented.length === 0) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(secret));
}

const brevoEventSchema = z.object({
  event: z.string().min(1).max(60),
  email: z.string().max(320).optional(),
  "message-id": z.string().max(300).optional(),
  id: z.union([z.string(), z.number()]).optional(),
  date: z.string().max(60).optional(),
  ts_event: z.number().optional(),
  ts: z.number().optional(),
  reason: z.string().max(300).optional(),
});

export type RecordEmailProviderEventArgs = {
  p_provider: "brevo";
  p_provider_event_id: string;
  p_provider_message_id: string | null;
  p_event_type: string;
  p_payload_safe: Record<string, unknown>;
  p_authenticated: boolean;
};

export class WebhookPayloadError extends Error {}

/** Parses one Brevo webhook JSON payload into the `record_email_provider_event` RPC arguments. */
export function parseBrevoWebhookEvent(rawBody: string, authenticated: boolean): RecordEmailProviderEventArgs {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new WebhookPayloadError("invalid_json");
  }
  const parsed = brevoEventSchema.safeParse(json);
  if (!parsed.success) throw new WebhookPayloadError("invalid_shape");

  const eventType = normalizeEventType(parsed.data.event);
  const providerMessageId = parsed.data["message-id"] ?? (parsed.data.id !== undefined ? String(parsed.data.id) : null);
  const timestamp = parsed.data.ts_event ?? parsed.data.ts ?? parsed.data.date ?? "";
  const providerEventId = createHash("sha256").update(`${eventType}|${providerMessageId ?? ""}|${timestamp}`, "utf8").digest("hex");

  return {
    p_provider: "brevo",
    p_provider_event_id: providerEventId,
    p_provider_message_id: providerMessageId,
    p_event_type: eventType,
    // PII minimisation: the recipient address is never persisted in the event evidence, only ids/timestamps.
    p_payload_safe: { event: parsed.data.event, message_id: providerMessageId, ts: timestamp || null, reason: parsed.data.reason ?? null },
    p_authenticated: authenticated,
  };
}

function normalizeEventType(rawEvent: string): string {
  const normalized = rawEvent
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z_]{2,40}$/.test(normalized) ? normalized : "unknown";
}
