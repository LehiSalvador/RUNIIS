// Single source of truth for the API error taxonomy (Master §164, §167, §178).
// Clients branch on `code`; `message` is a safe Spanish default for display.
export const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 400, message: "La solicitud no es válida." },
  AUTH_REQUIRED: { status: 401, message: "Debes iniciar sesión." },
  FORBIDDEN: { status: 403, message: "No tienes permiso para realizar esta acción." },
  NOT_FOUND: { status: 404, message: "El recurso no existe." },
  CONFLICT: { status: 409, message: "La solicitud entra en conflicto con el estado actual." },
  RESOURCE_EXPIRED: { status: 410, message: "El recurso ya no está disponible." },
  BUSINESS_RULE_VIOLATION: { status: 422, message: "La operación no está permitida." },
  RATE_LIMITED: { status: 429, message: "Demasiadas solicitudes. Intenta más tarde." },
  INTERNAL_ERROR: { status: 500, message: "Ocurrió un error inesperado." },
  DEPENDENCY_UNAVAILABLE: { status: 503, message: "Servicio temporalmente no disponible." },

  PROFILE_INCOMPLETE: { status: 422, message: "Completa tu perfil para continuar." },
  ACCOUNT_BANNED: { status: 403, message: "Tu cuenta no puede realizar esta acción." },
  IDENTITY_LOCKED: { status: 403, message: "Tu identidad está bloqueada para cambios." },
  AVATAR_UPLOAD_SUSPENDED: { status: 403, message: "La carga de avatar está suspendida." },
  REGISTRATION_NOT_OPEN: { status: 422, message: "Las inscripciones aún no están abiertas." },
  REGISTRATION_CLOSED: { status: 422, message: "Las inscripciones están cerradas." },
  EDITION_NOT_REGISTRABLE: { status: 422, message: "Esta edición no admite inscripciones." },
  MODALITY_NOT_AVAILABLE: { status: 422, message: "La modalidad no está disponible." },
  PARTICIPANT_NOT_ELIGIBLE: { status: 422, message: "El participante no es elegible." },
  GUARDIAN_REQUIRED: { status: 422, message: "Se requiere un tutor para este participante." },
  GUARDIAN_VERIFICATION_REQUIRED: { status: 422, message: "Se requiere verificar al tutor." },
  FORM_INVALID: { status: 422, message: "El formulario contiene respuestas no válidas." },
  LEGAL_ACCEPTANCE_REQUIRED: { status: 422, message: "Debes aceptar los documentos legales." },
  CLOSURE_BLOCKED: { status: 422, message: "El cierre está bloqueado por pendientes." },
  CAPACITY_UNAVAILABLE: { status: 409, message: "No hay cupo disponible en la modalidad." },
  GLOBAL_CAPACITY_UNAVAILABLE: { status: 409, message: "No hay cupo disponible en la edición." },
  DUPLICATE_REGISTRATION: { status: 409, message: "El participante ya está inscrito." },
  PARTICIPANT_ALREADY_HELD: { status: 409, message: "El participante ya tiene una solicitud activa." },
  PRICE_CHANGED: { status: 409, message: "El precio cambió. Revisa el total antes de continuar." },
  ALREADY_CHECKED_IN: { status: 409, message: "El participante ya registró su llegada." },
  RANKING_NOT_READY: { status: 409, message: "El ranking aún no está disponible." },
  IDEMPOTENCY_CONFLICT: { status: 409, message: "La clave de idempotencia ya se usó con otra solicitud." },
  REQUEST_EXPIRED: { status: 410, message: "La solicitud expiró." },
  PASS_REVOKED: { status: 410, message: "El pase fue revocado." },
  PASS_REPLACED: { status: 410, message: "El pase fue reemplazado." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CATALOG, value);
}

export type JsonObject = { [key: string]: unknown };

export type ApiSuccess<T, M extends JsonObject = JsonObject> = { data: T; meta: M };

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; request_id: string; details: JsonObject };
};
