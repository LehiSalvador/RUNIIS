import "server-only";
import { getServerEnv } from "../../env";
import { logEvent } from "../../log";
import type { EmailProvider, EmailSendResult, OutboundEmail } from "./types";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const SEND_TIMEOUT_MS = 15_000;
// 4xx other than 429 are the caller's fault (bad payload, revoked key, blocked sender): retrying would
// not help and would burn quota. 429 and 5xx/network failures are transient.
const PERMANENT_STATUS = new Set([400, 401, 403, 404, 422]);

/** Brevo transactional email via plain `fetch` (no SDK, per T35 scope). */
export function createBrevoEmailProvider(): EmailProvider {
  return {
    name: "brevo",
    async send(message: OutboundEmail): Promise<EmailSendResult> {
      const env = getServerEnv();
      const apiKey = env.BREVO_API_KEY;
      if (!apiKey) return { outcome: "RETRYABLE", errorCode: "PROVIDER_NOT_CONFIGURED" };

      let response: Response;
      try {
        response = await fetch(BREVO_SEND_URL, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "api-key": apiKey },
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          body: JSON.stringify({
            sender: { email: env.BREVO_SENDER_EMAIL ?? "no-responder@runiis.mx", name: env.BREVO_SENDER_NAME ?? "RUNIIS" },
            to: [{ email: message.toEmail }],
            subject: message.subject,
            htmlContent: message.html,
            textContent: message.text,
            headers: { "X-Runiis-Message-Key": message.messageKey, ...message.headers },
            attachment: message.attachment
              ? [{ content: message.attachment.content.toString("base64"), name: message.attachment.filename }]
              : undefined,
          }),
        });
      } catch (error) {
        logEvent("warn", "brevo_send_network_error", { error_name: error instanceof Error ? error.name : typeof error });
        return { outcome: "RETRYABLE", errorCode: "PROVIDER_UNREACHABLE" };
      }

      if (response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const messageId =
          body !== null && typeof body === "object" && "messageId" in body ? String((body as { messageId: unknown }).messageId) : null;
        if (!messageId) {
          logEvent("error", "brevo_send_missing_message_id", { status: response.status });
          return { outcome: "RETRYABLE", errorCode: "PROVIDER_BAD_RESPONSE" };
        }
        return { outcome: "ACCEPTED", providerMessageId: messageId };
      }

      const errorBody: unknown = await response.json().catch(() => null);
      const providerCode =
        errorBody !== null && typeof errorBody === "object" && "code" in errorBody ? String((errorBody as { code: unknown }).code) : null;
      logEvent(response.status >= 500 ? "warn" : "error", "brevo_send_rejected", { status: response.status, provider_code: providerCode });

      if (PERMANENT_STATUS.has(response.status)) {
        return { outcome: "PERMANENT", errorCode: `BREVO_${response.status}` };
      }
      return { outcome: "RETRYABLE", errorCode: response.status === 429 ? "PROVIDER_RATE_LIMITED" : `BREVO_${response.status}` };
    },
  };
}

/** `Retry-After` from a 429/503, capped, for the caller to combine with its own backoff. */
export function brevoRetryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null;
}
