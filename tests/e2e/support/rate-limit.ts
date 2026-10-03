/**
 * Waiting out `auth.verify.ip` (30 verifications per 10 minutes per client IP) on remote targets. Shared by the API
 * sign-in helper (account.ts) and the UI sign-in helper (journey.ts) so both use the same budget. Pure.
 */
export const VERIFY_RETRIES = 3;
export const VERIFY_MAX_WAIT_SECONDS = 90;
export const VERIFY_DEFAULT_WAIT_SECONDS = 60;

/** Seconds to wait after a 429: the Retry-After header when it is a positive number, else 60, never more than 90. */
export function verifyWaitSeconds(retryAfter: string | null | undefined): number {
  const seconds = Number(retryAfter ?? VERIFY_DEFAULT_WAIT_SECONDS) || VERIFY_DEFAULT_WAIT_SECONDS;
  return Math.max(1, Math.min(seconds, VERIFY_MAX_WAIT_SECONDS));
}

/** One line for the run log: what is being waited for and why. Carries no address, code or secret. */
export function verifyWaitMessage(channel: "api" | "ui", seconds: number, attempt: number): string {
  return `[e2e] auth.verify rate limited (429) on ${channel} sign-in; waiting ${seconds}s (retry ${attempt}/${VERIFY_RETRIES})`;
}
