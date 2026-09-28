import "server-only";
import type { ServerEnv } from "../../env";
import type { EmailProvider } from "./types";

export type EmailDeliveryMode = "live" | "allowlist" | "capture" | "refuse";

/**
 * A9/F5: unset resolves to capture outside production, and to a hard refuse-to-send in production.
 * An explicit `capture` is also refused in production (fail closed) so a misconfigured deploy can
 * never POST real recipients' mail to a local Mailpit-style endpoint; `allowlist` stays honoured.
 */
export function resolveEmailDeliveryMode(env: Pick<ServerEnv, "EMAIL_DELIVERY_MODE" | "APP_ENV">): EmailDeliveryMode {
  if (!env.EMAIL_DELIVERY_MODE) return env.APP_ENV === "production" ? "refuse" : "capture";
  if (env.EMAIL_DELIVERY_MODE === "capture" && env.APP_ENV === "production") return "refuse";
  return env.EMAIL_DELIVERY_MODE;
}

function allowlistedAddresses(env: Pick<ServerEnv, "EMAIL_ALLOWLIST">): ReadonlySet<string> {
  return new Set(
    (env.EMAIL_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * Which quota pool (`infra.communication_provider_policy.provider`) the dispatch worker claims
 * messages under for this run. `live` and `allowlist` both draw from the Brevo daily budget (in
 * `allowlist`, a non-allowlisted recipient is still transported via capture — see
 * `selectEmailProvider` — but the claimed slot is still accounted against Brevo's quota, since the
 * intent of allowlist mode is to rehearse production capacity). `refuse` claims nothing.
 */
export function dispatchQuotaPool(env: Pick<ServerEnv, "EMAIL_DELIVERY_MODE" | "APP_ENV">): "brevo" | "capture" | null {
  const mode = resolveEmailDeliveryMode(env);
  if (mode === "refuse") return null;
  return mode === "capture" ? "capture" : "brevo";
}

/**
 * Picks the provider for one recipient under the resolved delivery mode. `live` always uses Brevo;
 * `allowlist` uses Brevo only for allowlisted addresses (everything else is captured locally so a
 * staging-like config never reaches a real inbox by accident); `capture` never calls Brevo.
 */
export function selectEmailProvider(
  toEmail: string,
  env: Pick<ServerEnv, "EMAIL_DELIVERY_MODE" | "APP_ENV" | "EMAIL_ALLOWLIST">,
  brevo: EmailProvider,
  capture: EmailProvider,
): EmailProvider | null {
  const mode = resolveEmailDeliveryMode(env);
  if (mode === "refuse") return null;
  if (mode === "capture") return capture;
  if (mode === "live") return brevo;
  return allowlistedAddresses(env).has(toEmail.trim().toLowerCase()) ? brevo : capture;
}
