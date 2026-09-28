import type { ApiFailure, ApiFailureCode } from "@/lib/client/api";

/**
 * ux-spec §5.1 error catalogue for the signed-in surfaces. Clients branch on `code` only; the
 * server message is never shown verbatim when a catalogue string exists, and a stack/SQL text can
 * never reach the UI. INTERNAL_ERROR keeps the request id for support.
 */
const MESSAGES: Partial<Record<ApiFailureCode, string>> = {
  VALIDATION_ERROR: "Revisa los datos marcados.",
  AUTH_REQUIRED: "Tu sesión terminó. Inicia sesión para continuar.",
  FORBIDDEN: "No tienes permiso para esta acción.",
  NOT_FOUND: "No encontramos lo que buscas.",
  CONFLICT: "Alguien más actualizó esto. Recarga e intenta de nuevo.",
  RESOURCE_EXPIRED: "Esto ya expiró.",
  BUSINESS_RULE_VIOLATION: "Esta acción no está permitida en este momento.",
  RATE_LIMITED: "Espera un momento antes de intentar de nuevo.",
  INTERNAL_ERROR: "Algo salió mal. Intenta más tarde.",
  DEPENDENCY_UNAVAILABLE: "El servicio no está disponible. Intenta más tarde.",
  NETWORK_ERROR: "No pudimos conectar. Revisa tu conexión e intenta de nuevo.",
  PROFILE_INCOMPLETE: "Completa tu perfil para continuar.",
  ACCOUNT_BANNED: "Esta cuenta no puede realizar esta acción. Contacta a soporte.",
  IDENTITY_LOCKED: "Tu cuenta está en revisión. Contacta a soporte por WhatsApp.",
  REQUEST_EXPIRED: "Esta solicitud expiró.",
  PASS_REVOKED: "Este código ya no es válido.",
  PASS_REPLACED: "Este código ya no es válido, se reemplazó por uno nuevo.",
  IDEMPOTENCY_CONFLICT: "Algo cambió. Intenta de nuevo.",
  GUARDIAN_REQUIRED: "Este menor necesita un adulto responsable asignado antes de continuar.",
  LEGAL_ACCEPTANCE_REQUIRED: "Falta la aceptación de términos de uno o más participantes.",
};

export function errorMessage(failure: Pick<ApiFailure, "code">): string {
  return MESSAGES[failure.code] ?? MESSAGES.INTERNAL_ERROR!;
}

/** Support reference shown only for unexpected failures (ux-spec §5.1 "show request_id"). */
export function supportReference(failure: Pick<ApiFailure, "code" | "requestId">): string | null {
  return failure.code === "INTERNAL_ERROR" && failure.requestId ? failure.requestId : null;
}

/**
 * Field names that failed validation, from either shape the API produces: zod issues
 * (`details.issues[].path`, body location) or a DB command's `{field, reason}`.
 */
export function invalidFields(failure: Pick<ApiFailure, "code" | "details">): Map<string, string> {
  const fields = new Map<string, string>();
  if (failure.code !== "VALIDATION_ERROR") return fields;
  const { issues, field, reason } = failure.details as { issues?: unknown; field?: unknown; reason?: unknown };
  if (Array.isArray(issues)) {
    for (const issue of issues) {
      const path = (issue as { path?: unknown }).path;
      if (typeof path === "string" && path !== "" && !fields.has(path.split(".")[0])) fields.set(path.split(".")[0], "invalid");
    }
  }
  if (typeof field === "string") fields.set(field, typeof reason === "string" ? reason : "invalid");
  return fields;
}

export function retryAfterSeconds(failure: Pick<ApiFailure, "code" | "details">): number | null {
  const value = failure.details.retry_after_seconds;
  return failure.code === "RATE_LIMITED" && typeof value === "number" && value > 0 ? Math.ceil(value) : null;
}
