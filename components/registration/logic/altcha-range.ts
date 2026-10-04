import { solveChallenge } from "altcha-lib/v1";
import type { AltchaChallengeView } from "@/lib/shared/registration";

// Client side of the ALTCHA proof of work (OD-P2-01). The server issues the challenge, this only finds the number whose hash matches
// and wraps it in the payload the server verifies (single use, 2 minutes). Nothing here talks to the network or stores anything.
// No `import.meta` here: the Web Worker and the Node side of the E2E harness both import this file.

/** The server bounds its challenges at 100 000; refuse an absurd bound instead of spinning forever. */
export const MAX_SOLVE_NUMBER = 1_000_000;
const DEFAULT_MAX_NUMBER = 100_000;

export class AltchaSolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AltchaSolveError";
  }
}

export function challengeMax(challenge: Pick<AltchaChallengeView, "maxnumber">): number {
  const max = challenge.maxnumber ?? DEFAULT_MAX_NUMBER;
  if (!Number.isFinite(max) || max < 0 || max > MAX_SOLVE_NUMBER) throw new AltchaSolveError("challenge bound out of range");
  return max;
}

/**
 * The challenge embeds its own expiry (`salt` = `<random>?expires=<unix seconds>&`). Epoch milliseconds, or null when absent
 * (the caller then falls back to the 2 minute lifetime the server documents).
 */
export function challengeExpiresAt(challenge: Pick<AltchaChallengeView, "salt">): number | null {
  const query = challenge.salt.split("?")[1];
  if (!query) return null;
  const raw = new URLSearchParams(query).get("expires");
  if (!raw || !/^\d{1,12}$/.test(raw)) return null;
  return Number.parseInt(raw, 10) * 1000;
}

/** Base64 JSON exactly as the ALTCHA widget emits it; the server verifies it field by field. */
export function encodePayload(challenge: Pick<AltchaChallengeView, "algorithm" | "challenge" | "salt" | "signature">, number: number, took: number): string {
  const json = JSON.stringify({ algorithm: challenge.algorithm, challenge: challenge.challenge, number, salt: challenge.salt, signature: challenge.signature, took });
  return btoa(json);
}

export type RangeInput = Pick<AltchaChallengeView, "algorithm" | "challenge" | "salt">;

/**
 * Brute-forces `[start, max]` for the number whose hash is `challenge`. Hashing runs in WebCrypto (asynchronous, never a long
 * synchronous loop). Null = not in this range or aborted. Shared by the Web Worker and by the main-thread fallback.
 */
export async function solveRange(input: RangeInput, start: number, max: number, signal?: AbortSignal): Promise<{ number: number; took: number } | null> {
  const { promise, controller } = solveChallenge(input.challenge, input.salt, input.algorithm, max, start);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await promise;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
