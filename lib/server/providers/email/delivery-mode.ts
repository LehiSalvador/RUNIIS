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
 * P2-G9: an explicitly configured `MAILPIT_URL` is the only way an environment declares a capture sink. Without
 * one the capture transport can only target its loopback default, which does not exist on a deployed host (Vercel).
 */
function captureSinkConfigured(env: Pick<ServerEnv, "MAILPIT_URL">): boolean {
  return Boolean(env.MAILPIT_URL);
}

/**
 * P2-G9: in `allowlist` mode with no explicit capture sink (a deployed staging), the addresses mail may reach.
 * The dispatch claim passes this to SQL so every other recipient is terminally CANCELED (`NOT_ALLOWLISTED`)
 * before any quota is reserved. `null` means "no restriction" (every other mode, or allowlist with a capture
 * sink, where non-allowlisted recipients are still captured as before). An empty array suppresses everyone.
 */
export function allowlistClaimFilter(env: Pick<ServerEnv, "EMAIL_DELIVERY_MODE" | "APP_ENV" | "EMAIL_ALLOWLIST" | "MAILPIT_URL">): string[] | null {
  if (resolveEmailDeliveryMode(env) !== "allowlist" || captureSinkConfigured(env)) return null;
  return [...allowlistedAddresses(env)];
}

/** True when this recipient must not be transported anywhere under the allowlist-without-sink rule. */
export function isSuppressedByAllowlist(
  toEmail: string,
  env: Pick<ServerEnv, "EMAIL_DELIVERY_MODE" | "APP_ENV" | "EMAIL_ALLOWLIST" | "MAILPIT_URL">,
): boolean {
  const allowed = allowlistClaimFilter(env);
  return allowed !== null && !allowed.includes(toEmail.trim().toLowerCase());
}

/**
 * Which quota pool (`infra.communication_provider_policy.provider`) the dispatch worker claims
 * messages under for this run. `live` and `allowlist` both draw from the Brevo daily budget, but a
 * message is only reserved against it once it is actually going to be transported: in `allowlist` a
 * non-allowlisted recipient is either suppressed before the reservation (no capture sink, see
 * `allowlistClaimFilter`) or captured locally (explicit capture sink, rehearsal accounting as before).
 * `refuse` claims nothing.
 */
export function dispatchQuotaPool(env: Pick<ServerEnv, "EMAIL_DELIVERY_MODE" | "APP_ENV">): "brevo" | "capture" | null {
  const mode = resolveEmailDeliveryMode(env);
  if (mode === "refuse") return null;
  return mode === "capture" ? "capture" : "brevo";
}

/**
 * Picks the provider for one recipient under the resolved delivery mode. `live` always uses Brevo;
 * `allowlist` uses Brevo only for allowlisted addresses; everything else is captured when a capture sink is
 * explicitly configured and otherwise gets no provider at all (`null`, see `isSuppressedByAllowlist`) so a
 * staging-like config never reaches a real inbox by accident nor an unreachable transport; `capture` never calls Brevo.
 */
export function selectEmailProvider(
  toEmail: string,
  env: Pick<ServerEnv, "EMAIL_DELIVERY_MODE" | "APP_ENV" | "EMAIL_ALLOWLIST"> & Partial<Pick<ServerEnv, "MAILPIT_URL">>,
  brevo: EmailProvider,
  capture: EmailProvider,
): EmailProvider | null {
  const mode = resolveEmailDeliveryMode(env);
  if (mode === "refuse") return null;
  if (mode === "capture") return capture;
  if (mode === "live") return brevo;
  if (allowlistedAddresses(env).has(toEmail.trim().toLowerCase())) return brevo;
  return captureSinkConfigured(env) ? capture : null;
}
