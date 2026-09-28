/**
 * Pure countdown logic for CountdownStatus (ui-spec §3.3), extracted from the component so it is
 * testable without a DOM/timer: computed client-side every second from a server-provided
 * `expires_at`, never from local status (UX spec F1, J1 step 9); re-derives on every mount/tick so
 * a backgrounded tab never shows stale time.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const FINAL_WARNING_WINDOW_MS = 5 * 60 * 1000;

export type CountdownState = {
  remainingMs: number;
  expired: boolean;
  /** True in the last 5 minutes before expiry -- static warning tint, per §2.6 reduced-motion rule. */
  inFinalWarning: boolean;
  formatted: string;
};

export function getRemainingMs(expiresAt: string | Date, now: Date = new Date()): number {
  const expiresMs = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt.getTime();
  const remaining = expiresMs - now.getTime();
  // An unparseable expiry must never render as an endless hold: treat it as already expired.
  return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
}

/** HH:MM:SS under 24h, "Dd HH:MM" once the remaining time reaches a full day or more. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (remainingMs >= DAY_MS) {
    return `${days}d ${pad(hours)}:${pad(minutes)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function getCountdownState(expiresAt: string | Date, now: Date = new Date()): CountdownState {
  const remainingMs = getRemainingMs(expiresAt, now);
  const expired = remainingMs <= 0;

  return {
    remainingMs,
    expired,
    inFinalWarning: !expired && remainingMs <= FINAL_WARNING_WINDOW_MS,
    formatted: expired ? formatCountdown(0) : formatCountdown(remainingMs),
  };
}

/**
 * "Server-time based" clock: when the API response carries the server's current time, the client
 * clock's skew is measured once and applied to every tick, so a wrong device clock can neither
 * extend nor cut short a hold. Without `serverNow` it falls back to the device clock.
 */
export function createServerClock(serverNow?: string | Date | null, clientNowMs: number = Date.now()): () => Date {
  const serverMs = serverNow ? new Date(serverNow).getTime() : Number.NaN;
  const offsetMs = Number.isFinite(serverMs) ? serverMs - clientNowMs : 0;
  return () => new Date(Date.now() + offsetMs);
}
