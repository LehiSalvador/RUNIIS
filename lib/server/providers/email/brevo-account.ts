import "server-only";
import { getServerEnv } from "../../env";
import { logEvent } from "../../log";

const ACCOUNT_URL = "https://api.brevo.com/v3/account";
const FETCH_TIMEOUT_MS = 10_000;

export type BrevoAccountUsage = { dailyLimit: number | null; remaining: number | null };

/**
 * Best-effort read of Brevo's own quota for today's plan (`GET /v3/account`, `plan[].credits`/`creditsType`).
 * Not verified against a live account in this environment (no `BREVO_API_KEY` injected here — see the
 * T35 handoff blocker); defensive parsing means an unexpected response shape degrades to nulls instead
 * of throwing, so `provider-usage-reconcile` still refreshes the local OTP count on a bad/absent key.
 */
export async function fetchBrevoAccountUsage(): Promise<BrevoAccountUsage> {
  const apiKey = getServerEnv().BREVO_API_KEY;
  if (!apiKey) return { dailyLimit: null, remaining: null };

  try {
    const response = await fetch(ACCOUNT_URL, {
      headers: { accept: "application/json", "api-key": apiKey },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      logEvent("warn", "brevo_account_fetch_failed", { status: response.status });
      return { dailyLimit: null, remaining: null };
    }
    const body: unknown = await response.json();
    const plans = body !== null && typeof body === "object" && Array.isArray((body as { plan?: unknown }).plan) ? (body as { plan: unknown[] }).plan : [];
    for (const entry of plans) {
      if (entry === null || typeof entry !== "object") continue;
      const plan = entry as Record<string, unknown>;
      const creditsType = typeof plan.creditsType === "string" ? plan.creditsType : "";
      if (creditsType.toLowerCase().includes("sendlimit") || creditsType.toLowerCase().includes("email")) {
        const remaining = typeof plan.credits === "number" ? plan.credits : null;
        return { dailyLimit: null, remaining };
      }
    }
    return { dailyLimit: null, remaining: null };
  } catch (error) {
    logEvent("warn", "brevo_account_fetch_error", { error_name: error instanceof Error ? error.name : typeof error });
    return { dailyLimit: null, remaining: null };
  }
}
