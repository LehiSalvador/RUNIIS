import type { RegistrationCandidate, RegistrationContextModality } from "@/lib/shared/registration-context";

// Spanish (es-MX) copy for the registration flow. Source: T12 §5 / §5.1 error catalogue and the
// P2-B contract §2/§5 reason codes. Rules that matter here: "apartado" never "pagado"; a hold-caused
// block is "Temporalmente no disponible", never "Agotado"; nothing implies the buyer accepted for
// somebody else; no refund promises.

type Verdict = RegistrationCandidate["modalities"][number];

const REASON_MESSAGES: Record<string, string> = {
  // Inclusion (edition independent)
  GUARDIAN_REQUIRED: "Necesita un adulto responsable asignado antes de continuar.",
  UNDER_MIN_AGE: "Debe tener al menos 15 años el día del evento.",
  NOT_SELF_OR_FRIEND: "Solo puedes inscribir a tus amistades aceptadas.",
  GUEST_ARCHIVED: "Este invitado está archivado. Reactívalo en Invitados para inscribirlo.",
  PARTICIPANT_UNAVAILABLE: "Esta persona no está disponible para inscribirse en este momento.",
  PARTICIPANT_NOT_FOUND: "No encontramos a esta persona en tu cuenta.",
  PROFILE_NOT_READY: "Completa tu perfil para poder inscribirte.",
  IDENTITY_LOCKED: "Tu cuenta está en revisión. Contacta a soporte por WhatsApp.",
  ACCOUNT_BANNED: "Esta cuenta no puede realizar esta acción. Contacta a soporte.",
  // Modality / category
  MODALITY_RULE: "No cumple los requisitos de esta modalidad.",
  CATEGORY_RULE: "No cumple los requisitos de la categoría.",
  NO_CATEGORY_MATCH: "No hay una categoría disponible para esta persona.",
  MODALITY_CLOSED: "Esta modalidad ya no está disponible.",
};

const CODE_MESSAGES: Record<string, string> = {
  PARTICIPANT_NOT_ELIGIBLE: "Esta persona no cumple los requisitos para esta modalidad.",
  GUARDIAN_REQUIRED: REASON_MESSAGES.GUARDIAN_REQUIRED,
  MODALITY_NOT_AVAILABLE: "Esta modalidad ya no está disponible.",
  DUPLICATE_REGISTRATION: "Ya tiene un lugar en este evento.",
  PARTICIPANT_ALREADY_HELD: "Ya tiene un lugar apartado en este evento.",
  ACCOUNT_BANNED: REASON_MESSAGES.ACCOUNT_BANNED,
  IDENTITY_LOCKED: REASON_MESSAGES.IDENTITY_LOCKED,
  PROFILE_INCOMPLETE: REASON_MESSAGES.PROFILE_NOT_READY,
};

const GENERIC_INELIGIBLE = "No puede inscribirse en esta modalidad.";

/** Message for the first reason we have copy for, else for the verdict code, else a generic line. */
export function reasonsMessage(reasons: readonly string[], code: string | null = null): string {
  for (const reason of reasons) {
    const message = REASON_MESSAGES[reason];
    if (message) return message;
  }
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  return GENERIC_INELIGIBLE;
}

/** The buyer's own state reads in the second person (T12 §5.1: "Ya tienes un lugar en este evento."). */
export function verdictMessage(verdict: Pick<Verdict, "code" | "reasons">, isSelf: boolean): string {
  if (verdict.code === "DUPLICATE_REGISTRATION" && isSelf) return "Ya tienes un lugar en este evento.";
  if (verdict.code === "PARTICIPANT_ALREADY_HELD" && isSelf) return "Ya tienes un lugar apartado en este evento.";
  if (verdict.code === "DUPLICATE_REGISTRATION" || verdict.code === "PARTICIPANT_ALREADY_HELD") return CODE_MESSAGES[verdict.code];
  return reasonsMessage(verdict.reasons, verdict.code);
}

export const UNAVAILABLE_REASON_LABELS: Record<NonNullable<RegistrationContextModality["unavailable_reason"]>, string> = {
  MODALITY_CLOSED: "Modalidad cerrada",
  NO_PRICE: "Sin precio disponible",
  SOLD_OUT: "Agotado",
  TEMPORARILY_UNAVAILABLE: "Temporalmente no disponible",
};

export const RELATION_LABELS: Record<RegistrationCandidate["relation"], string> = {
  SELF: "Tú",
  FRIEND: "Amistad",
  WARD: "Menor a tu cargo",
  GUEST: "Invitado",
};

// ---- Form field validation reasons (P2-B contract §5, FORM_INVALID) ----

export type FieldConstraints = {
  min_length?: number;
  max_length?: number;
  min?: number;
  max?: number;
  min_date?: string;
  max_date?: string;
  min_items?: number;
  max_items?: number;
};

export function fieldReasonMessage(reason: string, config: FieldConstraints = {}): string {
  switch (reason) {
    case "required":
      return "Este campo es obligatorio.";
    case "too_short":
      return config.min_length ? `Escribe al menos ${config.min_length} caracteres.` : "La respuesta es muy corta.";
    case "too_long":
      return config.max_length ? `Usa máximo ${config.max_length} caracteres.` : "La respuesta es muy larga.";
    case "invalid_type":
      return "El valor no es válido.";
    case "invalid_option":
      return "Elige una opción de la lista.";
    case "duplicate_option":
      return "Hay opciones repetidas.";
    case "invalid_item_count":
      return config.min_items || config.max_items
        ? `Elige entre ${config.min_items ?? 0} y ${config.max_items ?? "las"} opciones permitidas.`
        : "Revisa cuántas opciones elegiste.";
    case "invalid_date":
      return "Escribe una fecha válida (dd/mm/aaaa).";
    case "out_of_range":
      if (config.min_date || config.max_date) return `Elige una fecha ${config.min_date ? `desde ${config.min_date} ` : ""}${config.max_date ? `hasta ${config.max_date}` : ""}`.trim() + ".";
      return config.min !== undefined || config.max !== undefined
        ? `Escribe un valor entre ${config.min ?? "el mínimo"} y ${config.max ?? "el máximo"}.`
        : "El valor está fuera del rango permitido.";
    case "not_integer":
      return "Escribe un número entero.";
    case "unknown_field":
      return "Este dato ya no se solicita. Revisa el formulario.";
    case "invalid_category":
      return "Elige una categoría válida.";
    case "invalid_kit":
    case "kit_variant_unavailable":
      return "La opción de kit no está disponible.";
    default:
      return "Revisa este dato.";
  }
}

export const MODE_LABELS = {
  FREE: "Evento gratuito",
  EXTERNAL_WHATSAPP: "Confirmación por WhatsApp",
} as const;
