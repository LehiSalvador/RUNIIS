import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { renderPassQrPng } from "../passes/credentials";
import { getServerEnv } from "../../env";
import { toAppError } from "../../http/errors";
import { logEvent } from "../../log";
import { dispatchQuotaPool, providerForRecipient } from "../../providers/email";
import type { OutboundEmail } from "../../providers/email";
import { callRpc } from "../../rpc";
import { backoffRetryAt } from "../../workers/outbox/backoff";
import { resolveTemplateVariables, renderTemplate, type TemplateVariableSchema } from "./render";

export const DISPATCH_WORKER_ID = "communication-dispatch";
const DEFAULT_LIMIT = 25;
const LEASE_SECONDS = 90;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 20 * 60_000;

const claimedMessageSchema = z.object({
  message_id: z.uuid(),
  attempt_number: z.number().int(),
  priority: z.number().int(),
  category: z.string(),
  template_key: z.string(),
  template_version: z.number().int(),
  campaign_id: z.uuid().nullable(),
  recipient_type: z.string(),
  to_email: z.string(),
  subject: z.string(),
  html_template: z.string(),
  text_template: z.string(),
  variable_schema: z.object({ variables: z.record(z.string(), z.record(z.string(), z.unknown())) }),
  variables: z.record(z.string(), z.unknown()),
  participant_pass_id: z.uuid().nullable(),
});
const claimedMessagesSchema = z.array(claimedMessageSchema);
const tokenResultSchema = z.object({ purpose: z.string().nullable(), expires_at: z.string().optional() });
const completeAttemptResultSchema = z.object({ applied: z.boolean(), status: z.string().optional() });

export type CommunicationDispatchSummary = { claimed: number; accepted: number; retried: number; failed: number; blocked: number };

/**
 * Claims due `communication_message` rows for the current delivery-mode quota pool, renders each
 * against its template, embeds the recipient's own pass QR when the template calls for it (A3:
 * rendered here, never persisted), mints unsubscribe/confirmation action tokens (SEC-082/084), sends
 * through the resolved provider and reports the outcome back to the SQL claim (Master §147-148).
 */
export async function runCommunicationDispatch(system: SupabaseClient, options: { limit?: number } = {}): Promise<CommunicationDispatchSummary> {
  const env = getServerEnv();
  const summary: CommunicationDispatchSummary = { claimed: 0, accepted: 0, retried: 0, failed: 0, blocked: 0 };
  const pool = dispatchQuotaPool(env);
  if (pool === null) {
    logEvent("error", "communication_dispatch_refused", { reason: "EMAIL_DELIVERY_MODE unset in production" });
    return summary;
  }

  const claimed = await callRpc(
    system,
    "claim_communication_messages",
    { p_worker: DISPATCH_WORKER_ID, p_provider: pool, p_limit: options.limit ?? DEFAULT_LIMIT, p_lease_seconds: LEASE_SECONDS },
    claimedMessagesSchema,
  );
  summary.claimed = claimed.length;

  for (const message of claimed) {
    const outcome = await dispatchOne(system, message, pool, env.APP_BASE_URL);
    if (outcome === "ACCEPTED") summary.accepted += 1;
    else if (outcome === "RETRYABLE") summary.retried += 1;
    else if (outcome === "BLOCKED") summary.blocked += 1;
    else summary.failed += 1;
  }
  return summary;
}

type ClaimedMessage = z.output<typeof claimedMessageSchema>;

async function dispatchOne(
  system: SupabaseClient,
  message: ClaimedMessage,
  pool: "brevo" | "capture",
  appBaseUrl: string,
): Promise<"ACCEPTED" | "RETRYABLE" | "PERMANENT" | "BLOCKED"> {
  try {
    const schema = message.variable_schema as TemplateVariableSchema;
    const systemVars: Record<string, unknown> = {};
    let attachment: OutboundEmail["attachment"] = null;
    let headers: Record<string, string> | undefined;

    if (schema.variables.has_pass_qr) {
      attachment = await resolveQrAttachment(system, message.participant_pass_id, systemVars);
    }
    if (schema.variables.confirm_url || schema.variables.unsubscribe_url) {
      headers = await resolveActionToken(system, message, schema, systemVars, appBaseUrl);
    }

    const resolved = resolveTemplateVariables(schema, message.variables, systemVars, appBaseUrl);
    const html = renderTemplate(message.html_template, resolved, { html: true });
    const text = renderTemplate(message.text_template, resolved, { html: false });

    const transport = providerForRecipient(message.to_email);
    if (!transport) {
      return await complete(system, message, pool, {
        outcome: "PERMANENT",
        provider: pool,
        providerMessageId: null,
        errorCode: "EMAIL_DELIVERY_REFUSED",
        retryAt: null,
      });
    }

    const email: OutboundEmail = {
      toEmail: message.to_email,
      subject: message.subject,
      html,
      text,
      messageKey: `${message.message_id}:${message.attempt_number}`,
      attachment,
      headers,
    };
    const sendResult = await transport.send(email);
    if (sendResult.outcome === "ACCEPTED") {
      return await complete(system, message, pool, {
        outcome: "ACCEPTED",
        provider: pool,
        providerMessageId: sendResult.providerMessageId,
        errorCode: null,
        retryAt: null,
      });
    }
    if (sendResult.outcome === "PERMANENT") {
      return await complete(system, message, pool, {
        outcome: "PERMANENT",
        provider: pool,
        providerMessageId: null,
        errorCode: sendResult.errorCode,
        retryAt: null,
      });
    }
    return await complete(system, message, pool, {
      outcome: "RETRYABLE",
      provider: pool,
      providerMessageId: null,
      errorCode: sendResult.errorCode,
      retryAt: backoffRetryAt(message.attempt_number, { baseMs: RETRY_BASE_MS, maxMs: RETRY_MAX_MS }),
    });
  } catch (error) {
    const appError = toAppError(error, { worker: DISPATCH_WORKER_ID, communication_message_id: message.message_id });
    logEvent("warn", "communication_dispatch_attempt_failed", { message_id: message.message_id, error_code: appError.code });
    return await complete(system, message, pool, {
      outcome: "RETRYABLE",
      provider: pool,
      providerMessageId: null,
      errorCode: appError.code,
      retryAt: backoffRetryAt(message.attempt_number, { baseMs: RETRY_BASE_MS, maxMs: RETRY_MAX_MS }),
    });
  }
}

/** A3: the QR is decrypted and rendered here only, embedded as an attachment, never written to storage. */
async function resolveQrAttachment(
  system: SupabaseClient,
  participantPassId: string | null,
  systemVars: Record<string, unknown>,
): Promise<OutboundEmail["attachment"]> {
  if (!participantPassId) {
    systemVars.has_pass_qr = false;
    return null;
  }
  try {
    const png = await renderPassQrPng(system, participantPassId);
    systemVars.has_pass_qr = true;
    return { filename: "pase-qr.png", contentType: "image/png", content: png };
  } catch (error) {
    const appError = toAppError(error, { participant_pass_id: participantPassId });
    if (appError.code === "NOT_FOUND") {
      // Pass state changed between claim and render (e.g. revoked); send without the attachment.
      systemVars.has_pass_qr = false;
      return null;
    }
    throw error; // DEPENDENCY_UNAVAILABLE / INTERNAL_ERROR: retry the whole message rather than send a half-broken email.
  }
}

async function resolveActionToken(
  system: SupabaseClient,
  message: ClaimedMessage,
  schema: TemplateVariableSchema,
  systemVars: Record<string, unknown>,
  appBaseUrl: string,
): Promise<Record<string, string> | undefined> {
  const plaintext = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(plaintext, "utf8").digest("hex");
  const result = await callRpc(
    system,
    "issue_communication_action_token",
    { p_message_id: message.message_id, p_worker: DISPATCH_WORKER_ID, p_attempt_number: message.attempt_number, p_token_hash: tokenHash },
    tokenResultSchema,
  );
  if (result.purpose === "REMINDER_CONFIRMATION" && schema.variables.confirm_url) {
    systemVars.confirm_url = new URL(`/recordatorios/confirmar?token=${plaintext}`, appBaseUrl).toString();
    return undefined;
  }
  if ((result.purpose === "UNSUBSCRIBE_MARKETING" || result.purpose === "UNSUBSCRIBE_REMINDERS") && schema.variables.unsubscribe_url) {
    const url = new URL(`/api/v1/communications/unsubscribe?token=${plaintext}`, appBaseUrl).toString();
    systemVars.unsubscribe_url = url;
    return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  }
  return undefined;
}

async function complete(
  system: SupabaseClient,
  message: ClaimedMessage,
  provider: "brevo" | "capture",
  args: { outcome: "ACCEPTED" | "RETRYABLE" | "PERMANENT"; provider: string; providerMessageId: string | null; errorCode: string | null; retryAt: Date | null },
): Promise<"ACCEPTED" | "RETRYABLE" | "PERMANENT" | "BLOCKED"> {
  const result = await callRpc(
    system,
    "complete_communication_attempt",
    {
      p_message_id: message.message_id,
      p_worker: DISPATCH_WORKER_ID,
      p_attempt_number: message.attempt_number,
      p_outcome: args.outcome,
      p_provider: provider,
      p_provider_message_id: args.providerMessageId,
      p_error_code: args.errorCode,
      p_retry_at: args.retryAt?.toISOString() ?? null,
    },
    completeAttemptResultSchema,
  );
  if (!result.applied) {
    logEvent("warn", "communication_attempt_not_applied", { message_id: message.message_id });
    return "BLOCKED";
  }
  return args.outcome;
}
