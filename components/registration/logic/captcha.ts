import type { ApiFailure } from "@/lib/client/api";
import { registrationCaptchaErrorDetailsSchema, type AltchaChallengeView, type RegistrationCaptchaReason } from "@/lib/shared/registration";

// OD-P2-01 anti-hoarding, participant side. The SERVER decides who is challenged (an EXTERNAL_WHATSAPP request from an
// account younger than 24 h); this module only models what the UI shows while it obtains, solves and sends the proof.

export const CAPTCHA_COPY = {
  title: "Confirma que eres una persona para enviar tu solicitud",
  solving: "Verificando… Esto toma unos segundos.",
  renewing: "Renovando la verificación…",
  solved: "Verificación lista. Ya puedes enviar tu solicitud.",
  probeFailed: "No pudimos preparar la verificación. Puedes intentar enviar igual o reintentar la verificación.",
  solveFailed: "No pudimos completar la verificación en este dispositivo. Reintenta para poder enviar.",
  required: "Necesitamos verificar que eres una persona antes de enviar tu solicitud. Espera a que termine la verificación e intenta de nuevo.",
  invalid: "La verificación no es válida o expiró. Inténtalo de nuevo.",
  retry: "Reintentar verificación",
} as const;

/** What the panel and the submit button need to know. The solved payload itself never lives in state (see the hook). */
export type CaptchaState =
  | { phase: "idle" }
  | { phase: "checking"; renewing: boolean }
  | { phase: "not_required" }
  | { phase: "solving"; renewing: boolean }
  | { phase: "solved" }
  | { phase: "error"; kind: "probe" | "solve" };

export const CAPTCHA_IDLE: CaptchaState = { phase: "idle" };

/** The panel is invisible unless the server asked for a challenge (FREE, older accounts and the probe itself render nothing). */
export function captchaVisible(state: CaptchaState): boolean {
  switch (state.phase) {
    case "solving":
    case "solved":
    case "error":
      return true;
    case "checking":
      return state.renewing;
    default:
      return false;
  }
}

/**
 * Whether the submit button must wait. While probing or solving the answer is "wait" (the probe is a read of a few hundred ms and
 * a click in that window would spend one of the 5 creation attempts on a guaranteed 422). A failed PROBE does not block: the server
 * stays the authority and answers captcha_required with a challenge the flow solves on the spot. A failed SOLVE blocks until retried.
 */
export function captchaBlocksSubmit(state: CaptchaState): boolean {
  switch (state.phase) {
    case "checking":
    case "solving":
      return true;
    case "error":
      return state.kind === "solve";
    default:
      return false;
  }
}

export type CaptchaFailure = { reason: RegistrationCaptchaReason; challenge: AltchaChallengeView | null };

/** `422 BUSINESS_RULE_VIOLATION` with `details.reason` captcha_required | captcha_invalid; key on the reason first (contract A.2). */
export function captchaFailureOf(failure: Pick<ApiFailure, "code" | "details">): CaptchaFailure | null {
  if (failure.code !== "BUSINESS_RULE_VIOLATION") return null;
  const reason = (failure.details as { reason?: unknown }).reason;
  if (reason !== "captcha_required" && reason !== "captcha_invalid") return null;
  const parsed = registrationCaptchaErrorDetailsSchema.safeParse(failure.details);
  return { reason, challenge: parsed.success ? parsed.data.captcha.challenge : null };
}

/** Milliseconds before a solved payload must be replaced: its own expiry minus a margin, else the documented 2 minutes minus the margin. */
export function renewDelayMs(expiresAt: number | null, now: number, marginMs = 10_000, lifetimeMs = 120_000): number {
  const target = expiresAt ?? now + lifetimeMs;
  return Math.max(1_000, target - marginMs - now);
}
