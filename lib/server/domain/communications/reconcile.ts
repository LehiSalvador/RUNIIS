import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchBrevoAccountUsage } from "../../providers/email/brevo-account";
import { callRpc } from "../../rpc";
import type { WorkerSummary } from "../../workers/registry";

const reconcileResultSchema = z.object({
  campaigns_started: z.number().int(),
  campaigns_closed: z.number().int(),
  schedule_messages: z.number().int(),
  birthday_messages: z.number().int(),
  escalated: z.number().int(),
  expired_pending_reminders: z.number().int(),
});
const usageResultSchema = z.object({ provider: z.string(), usage_date: z.string(), sent_total: z.number().int(), auth_otp: z.number().int(), daily_limit: z.number().int() });

/** `communication-reconcile` (15 min, Master §141/§150): schedule triggers, campaign lifecycle, escalations. */
export async function runCommunicationReconcile(system: SupabaseClient): Promise<WorkerSummary> {
  const result = await callRpc(system, "reconcile_communications", {}, reconcileResultSchema);
  return { ...result };
}

const RECONCILED_PROVIDERS = ["brevo", "capture"] as const;

/**
 * `provider-usage-reconcile` (daily): refreshes each provider's daily usage snapshot with the OTP
 * count and, for Brevo, the account's own reported quota when `BREVO_API_KEY` is configured (best
 * effort — see `brevo-account.ts`; unverified against a live account in this environment).
 */
export async function runProviderUsageReconcile(system: SupabaseClient): Promise<WorkerSummary> {
  const summary: WorkerSummary = {};
  for (const provider of RECONCILED_PROVIDERS) {
    const usage = provider === "brevo" ? await fetchBrevoAccountUsage() : { dailyLimit: null, remaining: null };
    const result = await callRpc(
      system,
      "reconcile_provider_usage",
      { p_provider: provider, p_daily_limit: usage.dailyLimit, p_remaining: usage.remaining },
      usageResultSchema,
    );
    summary[`${provider}_sent_total`] = result.sent_total;
    summary[`${provider}_auth_otp`] = result.auth_otp;
    summary[`${provider}_daily_limit`] = result.daily_limit;
  }
  return summary;
}
