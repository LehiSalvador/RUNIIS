import "server-only";

/** A message ready to hand to a provider: already rendered, already policy-checked. */
export type OutboundEmail = {
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side dedupe/correlation only; never persisted with PII beyond the message id itself. */
  messageKey: string;
  attachment: { filename: string; contentType: string; content: Buffer } | null;
  /** RFC 8058 one-click unsubscribe headers when the message carries an unsubscribe action token. */
  headers?: Record<string, string>;
};

export type EmailSendResult =
  | { outcome: "ACCEPTED"; providerMessageId: string }
  | { outcome: "RETRYABLE"; errorCode: string }
  | { outcome: "PERMANENT"; errorCode: string };

/** Every provider (real or local) implements this; the dispatcher never branches on provider name. */
export type EmailProvider = {
  readonly name: "brevo" | "capture";
  send(message: OutboundEmail): Promise<EmailSendResult>;
};
