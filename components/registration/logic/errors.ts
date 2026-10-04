import { errorMessage, retryAfterSeconds } from "@/lib/client/account-errors";
import type { ApiFailure } from "@/lib/client/api";
import type { RegistrationCandidate } from "@/lib/shared/registration-context";
import { CAPTCHA_COPY, captchaFailureOf, type CaptchaFailure } from "./captcha";
import { fieldReasonMessage, reasonsMessage } from "./copy";
import type { StepId } from "./model";

// Maps a failed POST /api/v1/registration-requests (P2-B contract §5) to what the UI must do. The browser
// never decides the outcome: it shows the server's verdict on the right participant/field, refreshes the
// context when the state moved, and keeps what the person typed.

export type BannerTone = "danger" | "warning" | "info";

export type FailureAction = {
  banner: { tone: BannerTone; title: string; body: string };
  /** Earliest step that holds something to fix. */
  goToStep: StepId | null;
  /** The server state moved (capacity, price, eligibility, window): re-read the registration context. */
  refreshContext: boolean;
  /** Account-level TERMS/PRIVACY acceptance is missing (LEGAL_ACCEPTANCE_REQUIRED scope ACCOUNT). */
  accountLegal: boolean;
  rowErrors: Record<string, string[]>;
  fieldErrors: Record<string, Record<string, string>>;
  categoryErrors: Record<string, string>;
  /** Names of the people the server rejected, for a notice that survives a row being dropped on refresh. */
  notices: string[];
  retryAfterSeconds: number | null;
  sessionExpired: boolean;
  /** Account state blocks registering at all: reload to let the server render the right screen. */
  accountBlocked: boolean;
  /** WhatsApp: a pending request already exists for this buyer and edition. */
  existingRequestId: string | null;
  /** The same payload may be replayed with the same Idempotency-Key (transport failure), or needs a new key. */
  keepIdempotencyKey: boolean;
  /** OD-P2-01: the 422 asked for (or rejected) the ALTCHA proof; the flow solves the fresh challenge it carries, keeps the same Idempotency-Key. */
  captcha: CaptchaFailure | null;
};

type Issue = {
  participant_index?: unknown;
  code?: unknown;
  reasons?: unknown;
  reason?: unknown;
  field_key?: unknown;
};

const STEP_ORDER: StepId[] = ["participants", "details", "legal", "review"];
const MODALITY_LEVEL_REASONS = new Set(["MODALITY_RULE", "CATEGORY_RULE", "NO_CATEGORY_MATCH", "MODALITY_CLOSED", "NO_PRICE", "MIXED_CURRENCY"]);

function nameOf(candidate: RegistrationCandidate | undefined): string {
  if (!candidate) return "Un participante";
  return candidate.relation === "SELF" ? "Tú" : (candidate.display_name ?? "Un participante");
}

function emptyAction(banner: FailureAction["banner"]): FailureAction {
  return {
    banner,
    goToStep: null,
    refreshContext: false,
    accountLegal: false,
    rowErrors: {},
    fieldErrors: {},
    categoryErrors: {},
    notices: [],
    retryAfterSeconds: null,
    sessionExpired: false,
    accountBlocked: false,
    existingRequestId: null,
    keepIdempotencyKey: false,
    captcha: null,
  };
}

function earliest(current: StepId | null, next: StepId): StepId {
  if (!current) return next;
  return STEP_ORDER.indexOf(next) < STEP_ORDER.indexOf(current) ? next : current;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function issuesOf(failure: Pick<ApiFailure, "details">): Issue[] {
  const issues = (failure.details as { issues?: unknown }).issues;
  return Array.isArray(issues) ? issues.filter((item): item is Issue => Boolean(item) && typeof item === "object") : [];
}

function issueMessage(issue: Issue): { text: string; step: StepId } {
  const code = typeof issue.code === "string" ? issue.code : "";
  const reasons = asStrings(issue.reasons);
  switch (code) {
    case "LEGAL_ACCEPTANCE_REQUIRED":
      return {
        text:
          issue.reason === "PARTICIPANT_ACCEPTANCE_PENDING"
            ? "Falta que esta persona acepte los documentos del evento desde su cuenta."
            : "Falta aceptar los documentos del evento.",
        step: "legal",
      };
    case "FORM_INVALID":
      return { text: fieldReasonMessage(typeof issue.reason === "string" ? issue.reason : ""), step: "details" };
    case "CAPACITY_UNAVAILABLE":
    case "GLOBAL_CAPACITY_UNAVAILABLE":
      return { text: "Ya no hay cupo disponible para esta modalidad.", step: "details" };
    case "MODALITY_NOT_AVAILABLE":
      return { text: reasonsMessage(reasons, code), step: "details" };
    case "PARTICIPANT_NOT_ELIGIBLE":
      return { text: reasonsMessage(reasons, code), step: reasons.some((reason) => MODALITY_LEVEL_REASONS.has(reason)) ? "details" : "participants" };
    default:
      return { text: reasonsMessage(reasons, code), step: "participants" };
  }
}

/**
 * The banner to show for a failed submit. F-3: an expired session is announced once, by SessionExpiredAlert (it carries the
 * sign-in action), so the generic banner is dropped to avoid saying "Tu sesión terminó" twice.
 */
export function bannerToShow(action: Pick<FailureAction, "banner" | "sessionExpired">): FailureAction["banner"] | null {
  return action.sessionExpired ? null : action.banner;
}

const CAPACITY_CODES = new Set(["CAPACITY_UNAVAILABLE", "GLOBAL_CAPACITY_UNAVAILABLE"]);

const WINDOW_COPY: Record<string, string> = {
  REGISTRATION_NOT_OPEN: "Las inscripciones aún no abren.",
  REGISTRATION_CLOSED: "Las inscripciones ya cerraron.",
  EDITION_NOT_REGISTRABLE: "Este evento no admite inscripciones en este momento.",
};

/**
 * @param order the selected candidates in the order they were sent (`participant_index` indexes into it).
 */
export function interpretCreateFailure(failure: ApiFailure, order: readonly RegistrationCandidate[]): FailureAction {
  const code = failure.code;

  // Anti-hoarding (OD-P2-01): a 422 BUSINESS_RULE_VIOLATION keyed on details.reason BEFORE the generic mapping below. Nothing the person
  // typed is lost and the Idempotency-Key is kept, so the solved resubmit is the same user action (contract A.1.3).
  const captcha = captchaFailureOf(failure);
  if (captcha) {
    const action = emptyAction({
      tone: "warning",
      title: captcha.reason === "captcha_invalid" ? CAPTCHA_COPY.invalid : "Falta verificar que eres una persona",
      body: captcha.reason === "captcha_invalid" ? "Estamos preparando una verificación nueva; cuando esté lista, vuelve a enviar." : CAPTCHA_COPY.required,
    });
    action.captcha = captcha;
    action.keepIdempotencyKey = true;
    return action;
  }

  if (code === "AUTH_REQUIRED") {
    const action = emptyAction({ tone: "warning", title: "Tu sesión terminó", body: "Inicia sesión de nuevo: conservamos lo que ya elegiste en este navegador." });
    action.sessionExpired = true;
    action.keepIdempotencyKey = true;
    return action;
  }
  if (code === "NETWORK_ERROR" || code === "DEPENDENCY_UNAVAILABLE") {
    const action = emptyAction({ tone: "danger", title: "No pudimos enviar tu solicitud", body: errorMessage(failure) + " Tus datos siguen aquí; si ya se había enviado, no se duplicará." });
    action.keepIdempotencyKey = true;
    return action;
  }
  if (code === "RATE_LIMITED") {
    const seconds = retryAfterSeconds(failure);
    const action = emptyAction({ tone: "warning", title: "Demasiados intentos", body: seconds ? "Espera un momento antes de intentar de nuevo." : errorMessage(failure) });
    action.retryAfterSeconds = seconds;
    action.keepIdempotencyKey = true;
    return action;
  }
  if (code === "IDEMPOTENCY_CONFLICT") {
    return emptyAction({ tone: "warning", title: "Algo cambió", body: "Algo cambió, intenta de nuevo." });
  }
  if (code === "PROFILE_INCOMPLETE" || code === "IDENTITY_LOCKED" || code === "ACCOUNT_BANNED" || code === "FORBIDDEN" || code === "NOT_FOUND") {
    const action = emptyAction({ tone: "danger", title: "No puedes continuar", body: errorMessage(failure) });
    action.accountBlocked = true;
    return action;
  }
  if (code === "CONFLICT") {
    const reason = (failure.details as { reason?: unknown }).reason;
    const id = (failure.details as { registration_request_id?: unknown }).registration_request_id;
    if (reason === "PENDING_REQUEST_EXISTS") {
      const action = emptyAction({ tone: "info", title: "Ya tienes una solicitud pendiente para este evento", body: "Mientras esté pendiente no puedes crear otra. Revísala o cancélala para empezar de nuevo." });
      action.existingRequestId = typeof id === "string" ? id : null;
      action.refreshContext = true;
      return action;
    }
  }
  if (code === "LEGAL_ACCEPTANCE_REQUIRED" && (failure.details as { scope?: unknown }).scope === "ACCOUNT") {
    const action = emptyAction({ tone: "warning", title: "Falta aceptar los términos de la cuenta", body: "Acepta los Términos y condiciones y el Aviso de privacidad para continuar." });
    action.accountLegal = true;
    action.goToStep = "legal";
    action.refreshContext = true;
    return action;
  }
  if (WINDOW_COPY[code]) {
    const action = emptyAction({ tone: "warning", title: WINDOW_COPY[code], body: "Actualizamos la información del evento. Tus datos no se enviaron." });
    action.refreshContext = true;
    return action;
  }
  if (code === "PRICE_CHANGED") {
    const action = emptyAction({ tone: "warning", title: "El precio cambió", body: "Revisa el total actualizado antes de enviar de nuevo." });
    action.refreshContext = true;
    action.goToStep = "review";
    return action;
  }

  const issues = issuesOf(failure);
  if (issues.length > 0) {
    const action = emptyAction({ tone: "danger", title: "Revisa tu solicitud", body: "" });
    let moved = false;
    for (const issue of issues) {
      const index = typeof issue.participant_index === "number" ? issue.participant_index : -1;
      const candidate = order[index];
      const key = candidate?.candidate_key;
      const issueCode = typeof issue.code === "string" ? issue.code : code;
      if (CAPACITY_CODES.has(issueCode) || issueCode === "MODALITY_NOT_AVAILABLE" || issueCode === "PARTICIPANT_NOT_ELIGIBLE" || issueCode === "DUPLICATE_REGISTRATION" || issueCode === "PARTICIPANT_ALREADY_HELD" || issueCode === "GUARDIAN_REQUIRED") {
        moved = true;
      }
      if (issueCode === "FORM_INVALID") {
        const fieldKey = typeof issue.field_key === "string" ? issue.field_key : null;
        const reason = typeof issue.reason === "string" ? issue.reason : "";
        if (key && fieldKey === "category_id") action.categoryErrors[key] = "Elige una categoría.";
        else if (key && fieldKey) (action.fieldErrors[key] ??= {})[fieldKey] = fieldReasonMessage(reason);
        else if (key) (action.rowErrors[key] ??= []).push(fieldReasonMessage(reason));
        action.goToStep = earliest(action.goToStep, "details");
        if (reason === "unknown_field") moved = true;
        continue;
      }
      const { text, step } = issueMessage({ ...issue, code: issueCode });
      if (key) (action.rowErrors[key] ??= []).push(text);
      action.notices.push(`${nameOf(candidate)}: ${text}`);
      action.goToStep = earliest(action.goToStep, step);
    }
    action.refreshContext = moved;
    action.banner.body =
      action.notices.length > 0
        ? action.notices.slice(0, 3).join(" ") + (action.notices.length > 3 ? ` Y ${action.notices.length - 3} más.` : "")
        : "Corrige los datos marcados y vuelve a enviar.";
    if (action.notices.length === 0) action.banner.title = "Revisa los datos marcados";
    return action;
  }

  if (code === "VALIDATION_ERROR") {
    const reason = (failure.details as { reason?: unknown }).reason;
    const action = emptyAction({
      tone: "danger",
      title: "Revisa los datos marcados",
      body: reason === "duplicate_participant" ? "Hay una persona repetida en tu solicitud." : errorMessage(failure),
    });
    action.refreshContext = true;
    return action;
  }
  if (CAPACITY_CODES.has(code)) {
    const action = emptyAction({ tone: "warning", title: "Ya no hay cupo disponible para completar esta solicitud.", body: "Actualizamos la disponibilidad. Elige otra modalidad o intenta más tarde." });
    action.refreshContext = true;
    action.goToStep = "details";
    return action;
  }
  if (code === "DUPLICATE_REGISTRATION" || code === "PARTICIPANT_ALREADY_HELD" || code === "PARTICIPANT_NOT_ELIGIBLE" || code === "GUARDIAN_REQUIRED" || code === "MODALITY_NOT_AVAILABLE") {
    const action = emptyAction({ tone: "warning", title: "Revisa a tus participantes", body: errorMessage(failure) });
    action.refreshContext = true;
    action.goToStep = "participants";
    return action;
  }

  const action = emptyAction({ tone: "danger", title: "No pudimos enviar tu solicitud", body: errorMessage(failure) });
  action.refreshContext = failure.status === 409 || failure.status === 422;
  return action;
}

/** Banner for a failed context refresh (read, not submit). */
export function describeRefreshFailure(failure: ApiFailure): { sessionExpired: boolean; accountBlocked: boolean; message: string } {
  return {
    sessionExpired: failure.code === "AUTH_REQUIRED",
    accountBlocked: failure.code === "PROFILE_INCOMPLETE" || failure.code === "IDENTITY_LOCKED" || failure.code === "ACCOUNT_BANNED" || failure.code === "FORBIDDEN",
    message: failure.code === "RATE_LIMITED" ? "Consultaste muy seguido. Espera un momento e intenta de nuevo." : errorMessage(failure),
  };
}
