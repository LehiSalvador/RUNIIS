import type { AltchaChallengeView } from "@/lib/shared/registration";
import { AltchaSolveError, challengeMax, encodePayload, solveRange, type RangeInput } from "./altcha-range";

export { AltchaSolveError, challengeExpiresAt, challengeMax, encodePayload, MAX_SOLVE_NUMBER } from "./altcha-range";

// Client side of the ALTCHA proof of work (OD-P2-01). The server issues the challenge, this only finds the
// number whose hash matches and wraps it in the payload the server verifies (single use, 2 minutes). Nothing
// here talks to the network and nothing is stored: the payload goes straight into the POST body.

type WorkerReply = { ok: true; number: number | null; took: number } | { ok: false };

function solveInWorkers(input: RangeInput, max: number, signal: AbortSignal | undefined): Promise<{ number: number; took: number } | null> {
  return new Promise((resolve, reject) => {
    const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
    const count = Math.max(1, Math.min(4, cores - 1, Math.ceil(max / 5_000)));
    const step = Math.ceil((max + 1) / count);
    const workers: Worker[] = [];
    let pending = count;
    let settled = false;

    const stop = () => {
      for (const worker of workers) worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      stop();
      action();
    };
    const onAbort = () => finish(() => resolve(null));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) return onAbort();

    try {
      for (let index = 0; index < count; index += 1) {
        const worker = new Worker(new URL("./altcha.worker.ts", import.meta.url), { type: "module" });
        workers.push(worker);
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
          const reply = event.data;
          if (!reply || !reply.ok) return finish(() => reject(new AltchaSolveError("worker failed")));
          if (reply.number !== null) return finish(() => resolve({ number: reply.number as number, took: reply.took }));
          pending -= 1;
          if (pending === 0) finish(() => resolve(null));
        };
        worker.onerror = () => finish(() => reject(new AltchaSolveError("worker unavailable")));
        const start = index * step;
        worker.postMessage({ algorithm: input.algorithm, challenge: input.challenge, salt: input.salt, start, max: Math.min(max, start + step - 1) });
      }
    } catch {
      finish(() => reject(new AltchaSolveError("worker unavailable")));
    }
  });
}

/** A signal that aborts when `parent` does or after `ms`, plus whether the deadline (and not the parent) was the cause. */
function deadline(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; expired: () => boolean; cancel: () => void } {
  const controller = new AbortController();
  let expired = false;
  const onParent = () => controller.abort();
  if (parent?.aborted) controller.abort();
  parent?.addEventListener("abort", onParent, { once: true });
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    expired: () => expired,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}

/** Workers get this long before the main-thread loop takes over (a worker that never answers must not leave the page waiting). */
export const WORKER_DEADLINE_MS = 8_000;
/** Hard stop for the whole solve: past this the person gets the retry button instead of an endless spinner. */
export const SOLVE_DEADLINE_MS = 45_000;

/**
 * Solves `challenge` and returns the payload to send as `altcha`. Prefers Web Workers (nothing runs on the main thread);
 * where workers are unavailable (blocked by CSP, old browser, or silent for WORKER_DEADLINE_MS) it falls back to the same asynchronous
 * loop on the main thread, which still yields between hashes. Rejects with AltchaSolveError when no solution exists or SOLVE_DEADLINE_MS
 * passes; an aborted solve rejects with AbortError.
 */
export async function solveAltcha(
  challenge: AltchaChallengeView,
  options: { signal?: AbortSignal; useWorkers?: boolean; workerDeadlineMs?: number; deadlineMs?: number } = {},
): Promise<string> {
  const { signal } = options;
  const max = challengeMax(challenge);
  const started = Date.now();
  const overall = deadline(signal, options.deadlineMs ?? SOLVE_DEADLINE_MS);
  const aborted = () => new DOMException("aborted", "AbortError");
  try {
    let solution: { number: number; took: number } | null = null;
    let tryMainThread = true;
    if (options.useWorkers ?? typeof Worker !== "undefined") {
      const workers = deadline(overall.signal, options.workerDeadlineMs ?? WORKER_DEADLINE_MS);
      try {
        solution = await solveInWorkers(challenge, max, workers.signal);
        tryMainThread = false;
      } catch (error) {
        if (!(error instanceof AltchaSolveError)) throw error;
      } finally {
        workers.cancel();
      }
      // Workers aborted because only the worker deadline passed (not the caller, not the overall deadline): fall through to the main thread.
      if (!tryMainThread && !solution && workers.expired() && !overall.signal.aborted) tryMainThread = true;
    }
    if (tryMainThread && !solution) solution = await solveRange(challenge, 0, max, overall.signal);
    if (signal?.aborted) throw aborted();
    if (overall.expired()) throw new AltchaSolveError("timed out");
    if (!solution) throw new AltchaSolveError("no solution within the challenge bound");
    return encodePayload(challenge, solution.number, solution.took || Date.now() - started);
  } finally {
    overall.cancel();
  }
}
