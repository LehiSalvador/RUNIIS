import type { ApiFailure, ApiFailureCode } from "@/lib/client/api";
import { invalidFields } from "@/lib/client/account-errors";

/**
 * Actionable error model for staff screens (P3-AC-15, Master §9.29). Every API error code (plus the
 * synthetic NETWORK_ERROR) maps to one of the kinds below with a Spanish message that tells the
 * operator what to do next. The server `message` is never shown: it is a generic default at best, and
 * a stack/SQL text can never reach the UI. The `request_id` is always kept so support can find the
 * request in the logs.
 *
 * `Record<ApiFailureCode, ...>` makes the table exhaustive at compile time: adding a code to
 * lib/shared/api-contract.ts without deciding its staff message fails typecheck.
 */
export type AdminErrorKind =
  | "validation" // the input needs fixing
  | "permission" // the role/account may not do this
  | "auth" // the session ended
  | "conflict" // another record/state blocks this
  | "capacity" // no places left / capacity rule
  | "stale" // the data changed under the operator; reload first
  | "provider" // a dependency (DB/provider/service) is unavailable
  | "network" // the browser could not reach the server
  | "rule" // a business rule forbids the operation in the current state
  | "not_found"
  | "rate_limit"
  | "unexpected";

export type AdminErrorAction = "retry" | "reload" | "signin" | "fix" | "support" | "none";

type ErrorSpec = { kind: AdminErrorKind; title: string; message: string; action: AdminErrorAction };

const SPEC: Record<ApiFailureCode, ErrorSpec> = {
  VALIDATION_ERROR: { kind: "validation", title: "Revisa los datos", message: "Hay campos con valores no válidos. Corrígelos y vuelve a guardar.", action: "fix" },
  FORM_INVALID: { kind: "validation", title: "Respuestas no válidas", message: "El formulario tiene respuestas que no cumplen las reglas. Revisa los campos marcados.", action: "fix" },
  AUTH_REQUIRED: { kind: "auth", title: "Tu sesión terminó", message: "Inicia sesión de nuevo para continuar. No se perdió nada de lo ya guardado.", action: "signin" },
  FORBIDDEN: { kind: "permission", title: "Sin permiso para esta acción", message: "Tu rol no puede hacer esto. Pide a un administrador que lo haga o que ajuste tu acceso.", action: "none" },
  ACCOUNT_BANNED: { kind: "permission", title: "Cuenta restringida", message: "Esta cuenta no puede realizar la acción. Contacta a un administrador.", action: "none" },
  IDENTITY_LOCKED: { kind: "permission", title: "Identidad bloqueada", message: "La identidad está bloqueada para cambios. Contacta a un administrador.", action: "none" },
  NOT_FOUND: { kind: "not_found", title: "No existe o ya no está disponible", message: "El registro no se encontró. Puede haberse eliminado o el enlace es incorrecto. Vuelve a la lista.", action: "none" },
  CONFLICT: { kind: "stale", title: "Alguien más lo cambió", message: "El registro cambió desde que lo abriste. Actualiza la pantalla y vuelve a intentar con los datos nuevos.", action: "reload" },
  IDEMPOTENCY_CONFLICT: { kind: "stale", title: "Operación ya procesada con otros datos", message: "Esa operación ya se envió con datos distintos. Actualiza la pantalla y repite la acción desde cero.", action: "reload" },
  RESOURCE_EXPIRED: { kind: "stale", title: "Ya expiró", message: "El recurso ya no está disponible. Actualiza la pantalla para ver su estado actual.", action: "reload" },
  REQUEST_EXPIRED: { kind: "stale", title: "La solicitud expiró", message: "El apartado venció y el cupo se liberó. Actualiza la pantalla para ver el estado actual.", action: "reload" },
  PRICE_CHANGED: { kind: "stale", title: "El precio cambió", message: "El precio vigente es distinto al que viste. Actualiza la pantalla y revisa el total antes de continuar.", action: "reload" },
  PASS_REVOKED: { kind: "stale", title: "Pase revocado", message: "Este pase ya no es válido. Actualiza la pantalla para ver su estado.", action: "reload" },
  PASS_REPLACED: { kind: "stale", title: "Pase reemplazado", message: "Este pase fue sustituido por uno nuevo. Actualiza la pantalla para ver el vigente.", action: "reload" },
  CAPACITY_UNAVAILABLE: { kind: "capacity", title: "Sin cupo en la modalidad", message: "La modalidad no tiene lugares libres. Libera un apartado o ajusta la capacidad antes de reintentar.", action: "none" },
  GLOBAL_CAPACITY_UNAVAILABLE: { kind: "capacity", title: "Sin cupo en la edición", message: "La edición llegó a su capacidad global. Libera cupo o ajusta la capacidad antes de reintentar.", action: "none" },
  DUPLICATE_REGISTRATION: { kind: "conflict", title: "Ya está inscrito", message: "El participante ya tiene una inscripción en esta edición. Abre la inscripción existente en lugar de crear otra.", action: "none" },
  PARTICIPANT_ALREADY_HELD: { kind: "conflict", title: "Ya tiene una solicitud activa", message: "El participante ya tiene un apartado vigente en esta edición. Resuélvelo (confirmar o cancelar) primero.", action: "none" },
  ALREADY_CHECKED_IN: { kind: "conflict", title: "Ya registró su llegada", message: "Este participante ya hizo check-in. No hace falta repetirlo.", action: "none" },
  BUSINESS_RULE_VIOLATION: { kind: "rule", title: "No se puede en este estado", message: "La operación no está permitida con el estado actual del registro. Revisa el estado y los requisitos.", action: "none" },
  CLOSURE_BLOCKED: { kind: "rule", title: "El cierre está bloqueado", message: "Hay pendientes sin resolver (por ejemplo asistencia). Resuélvelos y vuelve a intentar el cierre.", action: "none" },
  REGISTRATION_NOT_OPEN: { kind: "rule", title: "Inscripciones no abiertas", message: "La edición todavía no abre inscripciones. Revisa la ventana de inscripción.", action: "none" },
  REGISTRATION_CLOSED: { kind: "rule", title: "Inscripciones cerradas", message: "La ventana de inscripción ya cerró. Reábrela desde la edición si corresponde.", action: "none" },
  EDITION_NOT_REGISTRABLE: { kind: "rule", title: "Edición sin inscripciones", message: "La edición no admite inscripciones en su estado actual. Revisa su publicación y ejecución.", action: "none" },
  MODALITY_NOT_AVAILABLE: { kind: "rule", title: "Modalidad no disponible", message: "La modalidad está cerrada o cancelada. Elige otra o reactívala.", action: "none" },
  PARTICIPANT_NOT_ELIGIBLE: { kind: "rule", title: "Participante no elegible", message: "El participante no cumple las reglas de elegibilidad de la modalidad.", action: "none" },
  GUARDIAN_REQUIRED: { kind: "rule", title: "Falta tutor", message: "El participante menor necesita un adulto responsable vinculado antes de continuar.", action: "none" },
  GUARDIAN_VERIFICATION_REQUIRED: { kind: "rule", title: "Falta verificar al tutor", message: "Verifica presencialmente al tutor antes de completar el check-in del menor.", action: "none" },
  LEGAL_ACCEPTANCE_REQUIRED: { kind: "rule", title: "Falta aceptación legal", message: "Hay participantes sin los documentos legales aceptados. No se puede continuar hasta que los acepten.", action: "none" },
  PROFILE_INCOMPLETE: { kind: "rule", title: "Perfil incompleto", message: "El perfil de la persona está incompleto. Debe completarlo para continuar.", action: "none" },
  AVATAR_UPLOAD_SUSPENDED: { kind: "permission", title: "Carga de avatar suspendida", message: "A esta cuenta se le suspendió la carga de avatar.", action: "none" },
  RANKING_NOT_READY: { kind: "rule", title: "Ranking no disponible", message: "El ranking todavía no está listo. Inténtalo cuando termine la consolidación.", action: "none" },
  RATE_LIMITED: { kind: "rate_limit", title: "Demasiadas acciones", message: "Demasiadas acciones seguidas: espera un momento antes de intentar de nuevo.", action: "retry" },
  DEPENDENCY_UNAVAILABLE: { kind: "provider", title: "Servicio no disponible", message: "Un servicio del que depende esta pantalla no responde. Reintenta en un momento; si sigue, avisa a soporte con la referencia.", action: "retry" },
  NETWORK_ERROR: { kind: "network", title: "Sin conexión con el servidor", message: "No pudimos conectar. Revisa tu conexión y reintenta; lo que no se haya guardado no se aplicó.", action: "retry" },
  INTERNAL_ERROR: { kind: "unexpected", title: "Algo salió mal", message: "Ocurrió un error inesperado. Reintenta y, si persiste, avisa a soporte con la referencia.", action: "support" },
};

export type AdminErrorTone = "warning" | "danger" | "info";

const TONE: Record<AdminErrorKind, AdminErrorTone> = {
  validation: "warning",
  permission: "danger",
  auth: "warning",
  conflict: "warning",
  capacity: "warning",
  stale: "info",
  provider: "danger",
  network: "danger",
  rule: "warning",
  not_found: "info",
  rate_limit: "info",
  unexpected: "danger",
};

export const KIND_LABEL: Record<AdminErrorKind, string> = {
  validation: "Validación",
  permission: "Permiso",
  auth: "Sesión",
  conflict: "Conflicto",
  capacity: "Capacidad",
  stale: "Datos desactualizados",
  provider: "Servicio externo",
  network: "Red",
  rule: "Regla de negocio",
  not_found: "No encontrado",
  rate_limit: "Límite de uso",
  unexpected: "Error inesperado",
};

export type AdminErrorView = {
  code: ApiFailureCode;
  kind: AdminErrorKind;
  tone: AdminErrorTone;
  title: string;
  message: string;
  action: AdminErrorAction;
  /** Always kept when known, for every kind, so support can correlate the request. */
  requestId: string | null;
  /** Fields the server flagged as invalid (validation only), name -> reason. */
  fields: Map<string, string>;
  /** Seconds to wait before retrying (RATE_LIMITED only). */
  retryAfterSeconds: number | null;
};

type FailureLike = { code: ApiFailureCode; requestId?: string | null; details?: ApiFailure["details"] };

const UNKNOWN: ErrorSpec = SPEC.INTERNAL_ERROR;

export function describeFailure(failure: FailureLike): AdminErrorView {
  // An unrecognised code (a newer server) degrades to the generic, never to raw text.
  const spec = Object.hasOwn(SPEC, failure.code) ? SPEC[failure.code] : UNKNOWN;
  const details = failure.details ?? {};
  const retry = failure.code === "RATE_LIMITED" ? details.retry_after_seconds : undefined;
  return {
    code: failure.code,
    kind: spec.kind,
    tone: TONE[spec.kind],
    title: spec.title,
    message: spec.message,
    action: spec.action,
    requestId: failure.requestId ?? null,
    fields: invalidFields({ code: failure.code, details }),
    retryAfterSeconds: typeof retry === "number" && retry > 0 ? Math.ceil(retry) : null,
  };
}

/** The kinds the acceptance criterion names, for tests and docs. */
export const REQUIRED_KINDS: readonly AdminErrorKind[] = ["validation", "permission", "conflict", "capacity", "stale", "provider", "network"];

/** Codes the table covers, for the exhaustiveness unit test. */
export const COVERED_CODES = Object.keys(SPEC) as ApiFailureCode[];
