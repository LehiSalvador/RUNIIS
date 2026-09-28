// Exponential backoff with full jitter (Master §147-148): shared by the outbox dispatcher and the
// communication message dispatcher so every retryable effect in T35 backs off the same way. Pure
// function, no imports, so it is trivially unit-testable and usable from Netlify functions too.

export type BackoffOptions = { baseMs?: number; factor?: number; maxMs?: number; jitterRatio?: number };

const DEFAULTS: Required<BackoffOptions> = { baseMs: 2_000, factor: 2, maxMs: 15 * 60_000, jitterRatio: 1 };

/**
 * `attempt` is 1-based (the attempt that just failed). Returns the delay in ms before the next try,
 * clamped to `maxMs`. `jitterRatio` of 1 means "full jitter": uniform in `[0, cappedDelay]`, which
 * spreads retries the most and is what AWS's backoff guidance recommends for many competing workers.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}, random: () => number = Math.random): number {
  const { baseMs, factor, maxMs, jitterRatio } = { ...DEFAULTS, ...options };
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const capped = Math.min(maxMs, baseMs * factor ** (safeAttempt - 1));
  const jitterFloor = capped * (1 - jitterRatio);
  return Math.round(jitterFloor + random() * (capped - jitterFloor));
}

export function backoffRetryAt(attempt: number, options: BackoffOptions = {}, now: () => number = Date.now): Date {
  return new Date(now() + backoffDelayMs(attempt, options));
}
