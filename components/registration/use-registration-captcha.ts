"use client";

import React from "react";
import { apiFetch } from "@/lib/client/api";
import { registrationCaptchaStatusSchema, type AltchaChallengeView } from "@/lib/shared/registration";
import { challengeExpiresAt, solveAltcha } from "./logic/altcha-solver";
import { CAPTCHA_IDLE, renewDelayMs, type CaptchaState } from "./logic/captcha";

/** How long the probe may take before the panel falls back to "try anyway" (the server stays the authority). */
const PROBE_DEADLINE_MS = 20_000;

export type RegistrationCaptcha = {
  state: CaptchaState;
  /**
   * The solved payload, handed over ONCE (a payload is single use): null when none is held, it already expired, or the server did not
   * ask for one. It never touches the draft, storage or logs; it lives in this ref only until it is sent.
   */
  takePayload: () => string | null;
  /** Solve a challenge the server just handed back inside a 422 (stale page, deep link, invalid payload). Resolves null on failure or abort. */
  solve: (challenge: AltchaChallengeView) => Promise<string | null>;
  /** Ask the server again (after a failed submit the clearance may already be held; after an error the person retries). */
  recheck: () => void;
};

/**
 * Anti-hoarding challenge for the review step (contract A.1). Probes `GET /registration-requests/challenge` as soon as the step is
 * shown, solves the challenge in the browser only when the server says it is required, renews it before its two minutes run out,
 * and exposes the payload for the submit. FREE Editions never enable it and an account the server does not challenge ends in
 * `not_required` without showing anything.
 */
export function useRegistrationCaptcha({ editionId, enabled }: { editionId: string; enabled: boolean }): RegistrationCaptcha {
  const [state, setState] = React.useState<CaptchaState>(CAPTCHA_IDLE);
  const [nonce, setNonce] = React.useState(0);
  const payload = React.useRef<{ value: string; expiresAt: number | null } | null>(null);
  const run = React.useRef<AbortController | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const renewing = React.useRef(false);

  const clearTimer = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const begin = React.useCallback((): AbortController => {
    run.current?.abort();
    clearTimer();
    const controller = new AbortController();
    run.current = controller;
    return controller;
  }, [clearTimer]);

  const solveWith = React.useCallback(async (challenge: AltchaChallengeView, signal: AbortSignal, isRenewal: boolean): Promise<string | null> => {
    setState({ phase: "solving", renewing: isRenewal });
    try {
      const solved = await solveAltcha(challenge, { signal });
      if (signal.aborted) return null;
      const expiresAt = challengeExpiresAt(challenge);
      payload.current = { value: solved, expiresAt };
      setState({ phase: "solved" });
      // A challenge lives 2 minutes: renew it while the person is still reviewing, never send a stale one.
      timer.current = setTimeout(() => {
        renewing.current = true;
        setNonce((current) => current + 1);
      }, renewDelayMs(expiresAt, Date.now()));
      return solved;
    } catch {
      if (!signal.aborted) setState({ phase: "error", kind: "solve" });
      return null;
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    const isRenewal = renewing.current;
    renewing.current = false;
    const controller = begin();
    payload.current = null;
    void (async () => {
      setState({ phase: "checking", renewing: isRenewal });
      // A probe that never answers must not leave the button disabled for ever: past the deadline the person can still try (the 422 rescues).
      let slow = false;
      const watchdog = setTimeout(() => {
        slow = true;
        controller.abort();
      }, PROBE_DEADLINE_MS);
      let result;
      try {
        result = await apiFetch<unknown>(`/api/v1/registration-requests/challenge?edition_id=${encodeURIComponent(editionId)}`, { signal: controller.signal });
      } catch {
        if (slow) setState({ phase: "error", kind: "probe" });
        return; // otherwise aborted by a newer run, which owns the state
      } finally {
        clearTimeout(watchdog);
      }
      if (controller.signal.aborted) return;
      const status = result.ok ? registrationCaptchaStatusSchema.safeParse(result.data) : null;
      if (!status || !status.success) {
        setState({ phase: "error", kind: "probe" });
        return;
      }
      if (!status.data.required || !status.data.challenge) {
        setState({ phase: "not_required" });
        return;
      }
      await solveWith(status.data.challenge, controller.signal, isRenewal);
    })();
    return () => {
      // Leaving the review step (or re-asking): forget everything, a payload never outlives the run that solved it.
      controller.abort();
      clearTimer();
      payload.current = null;
      setState(CAPTCHA_IDLE);
    };
  }, [enabled, editionId, nonce, begin, clearTimer, solveWith]);

  const takePayload = React.useCallback((): string | null => {
    const held = payload.current;
    payload.current = null;
    clearTimer();
    if (!held) return null;
    if (held.expiresAt !== null && held.expiresAt <= Date.now()) return null;
    return held.value;
  }, [clearTimer]);

  const solve = React.useCallback(
    (challenge: AltchaChallengeView) => {
      const controller = begin();
      payload.current = null;
      return solveWith(challenge, controller.signal, false);
    },
    [begin, solveWith],
  );

  const recheck = React.useCallback(() => setNonce((current) => current + 1), []);

  React.useEffect(
    () => () => {
      run.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { state, takePayload, solve, recheck };
}
