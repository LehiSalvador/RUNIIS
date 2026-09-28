import { describe, expect, it } from "vitest";
import { isAuthorizedBrevoWebhook, parseBrevoWebhookEvent, WebhookPayloadError, BREVO_WEBHOOK_SECRET_HEADER } from "@/lib/server/domain/communications/webhook";

const SECRET = "unit-test-brevo-webhook-secret-value";

describe("isAuthorizedBrevoWebhook", () => {
  it("rejects when no secret is configured (fails closed)", () => {
    const headers = new Headers({ [BREVO_WEBHOOK_SECRET_HEADER]: SECRET });
    expect(isAuthorizedBrevoWebhook(headers, undefined)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedBrevoWebhook(new Headers(), SECRET)).toBe(false);
  });

  it("rejects a wrong secret of the same length (constant-time path)", () => {
    const wrong = "x".repeat(SECRET.length);
    const headers = new Headers({ [BREVO_WEBHOOK_SECRET_HEADER]: wrong });
    expect(isAuthorizedBrevoWebhook(headers, SECRET)).toBe(false);
  });

  it("rejects a wrong secret of a different length", () => {
    const headers = new Headers({ [BREVO_WEBHOOK_SECRET_HEADER]: "short" });
    expect(isAuthorizedBrevoWebhook(headers, SECRET)).toBe(false);
  });

  it("accepts the exact configured secret", () => {
    const headers = new Headers({ [BREVO_WEBHOOK_SECRET_HEADER]: SECRET });
    expect(isAuthorizedBrevoWebhook(headers, SECRET)).toBe(true);
  });
});

describe("parseBrevoWebhookEvent", () => {
  it("parses a well-formed event and normalizes the event type", () => {
    const args = parseBrevoWebhookEvent(JSON.stringify({ event: "hard_bounce", email: "runner@example.test", "message-id": "<abc@brevo>", ts: 1700000000 }), true);
    expect(args.p_event_type).toBe("hard_bounce");
    expect(args.p_provider_message_id).toBe("<abc@brevo>");
    expect(args.p_authenticated).toBe(true);
    expect(args.p_provider_event_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never includes the recipient email in the safe payload (PII minimisation)", () => {
    const args = parseBrevoWebhookEvent(JSON.stringify({ event: "delivered", email: "runner@example.test", id: 42 }), true);
    expect(JSON.stringify(args.p_payload_safe)).not.toContain("runner@example.test");
  });

  it("falls back to the numeric id when message-id is absent", () => {
    const args = parseBrevoWebhookEvent(JSON.stringify({ event: "spam", id: 12345 }), false);
    expect(args.p_provider_message_id).toBe("12345");
    expect(args.p_authenticated).toBe(false);
  });

  it("produces the same provider_event_id for the same event (idempotent dedupe key)", () => {
    const payload = JSON.stringify({ event: "delivered", "message-id": "<same@brevo>", ts: 1700000001 });
    expect(parseBrevoWebhookEvent(payload, true).p_provider_event_id).toBe(parseBrevoWebhookEvent(payload, true).p_provider_event_id);
  });

  it("throws WebhookPayloadError on invalid JSON", () => {
    expect(() => parseBrevoWebhookEvent("not json", true)).toThrow(WebhookPayloadError);
  });

  it("throws WebhookPayloadError when the required event field is missing", () => {
    expect(() => parseBrevoWebhookEvent(JSON.stringify({ email: "runner@example.test" }), true)).toThrow(WebhookPayloadError);
  });

  it("normalizes an unrecognized/garbled event name to 'unknown' instead of rejecting it (SEC-080 evidence-only)", () => {
    const args = parseBrevoWebhookEvent(JSON.stringify({ event: "!!!" }), true);
    expect(args.p_event_type).toBe("unknown");
  });
});
