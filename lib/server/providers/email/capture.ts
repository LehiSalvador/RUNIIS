import "server-only";
import { getServerEnv } from "../../env";
import { logEvent } from "../../log";
import type { EmailProvider, EmailSendResult, OutboundEmail } from "./types";

const DEFAULT_MAILPIT_URL = "http://127.0.0.1:54624";
const SEND_TIMEOUT_MS = 5_000;

/**
 * Non-production adapter: delivers into the local Mailpit HTTP API (`POST /api/v1/send`) instead of a
 * real provider. Never used in production: `resolveEmailDeliveryMode` (F5) maps an unset mode, and an
 * explicit `capture`, to `refuse` whenever `APP_ENV === "production"`, so `selectEmailProvider` never
 * returns this adapter there. Integration tests
 * read the same Mailpit instance back via its `/api/v1/messages` API (T20's `fetchOtpCode` pattern).
 */
export function createCaptureEmailProvider(): EmailProvider {
  return {
    name: "capture",
    async send(message: OutboundEmail): Promise<EmailSendResult> {
      const baseUrl = getServerEnv().MAILPIT_URL ?? DEFAULT_MAILPIT_URL;
      try {
        const response = await fetch(new URL("/api/v1/send", baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          body: JSON.stringify({
            From: { Email: fromAddress(), Name: fromName() },
            To: [{ Email: message.toEmail }],
            Subject: message.subject,
            HTML: message.html,
            Text: message.text,
            Headers: { "X-Runiis-Message-Key": message.messageKey, ...message.headers },
            Attachments: message.attachment
              ? [
                  {
                    Content: message.attachment.content.toString("base64"),
                    Filename: message.attachment.filename,
                    ContentType: message.attachment.contentType,
                  },
                ]
              : undefined,
          }),
        });
        if (!response.ok) {
          logEvent("warn", "capture_email_send_failed", { status: response.status });
          return { outcome: "RETRYABLE", errorCode: "CAPTURE_UNAVAILABLE" };
        }
        const body: unknown = await response.json();
        const id = body !== null && typeof body === "object" && "ID" in body ? String((body as { ID: unknown }).ID) : null;
        if (!id) return { outcome: "RETRYABLE", errorCode: "CAPTURE_UNAVAILABLE" };
        return { outcome: "ACCEPTED", providerMessageId: `capture:${id}` };
      } catch {
        // Mailpit not reachable (e.g. Docker stack down): retryable, never a permanent failure.
        return { outcome: "RETRYABLE", errorCode: "CAPTURE_UNAVAILABLE" };
      }
    },
  };
}

function fromAddress(): string {
  return getServerEnv().BREVO_SENDER_EMAIL ?? "no-responder@runiis.test";
}

function fromName(): string {
  return getServerEnv().BREVO_SENDER_NAME ?? "RUNIIS";
}
