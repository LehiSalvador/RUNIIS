import { Ban, CircleCheck, CircleHelp, CircleX, Clock, Flag, Info, ShieldX, TriangleAlert, UserCheck, type LucideIcon } from "lucide-react";

/**
 * The 11 scan outcomes the server returns (Master §85, lib/server/domain/raceday/contracts.ts scanOutcomeSchema), verbatim,
 * with the ScannerFeedback presentation of T13 §3.6: icon, semantic tone, label. The SERVER is the only judge of a
 * credential; this table only decides how an answer looks and how long it stays. Nothing here reads or interprets a QR.
 *
 * Labels follow T13 §3.6 word for word, written with Spanish accents (the spec text is ASCII-folded).
 * Copy rule: check-in is evidence of arrival, never final attendance, so no label says "asistencia" or "presente".
 */
export const SCAN_OUTCOMES = [
  "VALID",
  "ALREADY_CHECKED_IN",
  "REVOKED_CREDENTIAL",
  "REPLACED_CREDENTIAL",
  "WRONG_EVENT",
  "REGISTRATION_NOT_CONFIRMED",
  "GUARDIAN_VERIFICATION_REQUIRED",
  "UNKNOWN_PASS",
  "CANCELED_REGISTRATION",
  "NOT_YET_ALLOWED",
  "OTHER_REVIEW",
] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

export type OutcomeTone = "success" | "info" | "warning" | "danger";

export type OutcomeSpec = {
  icon: LucideIcon;
  tone: OutcomeTone;
  /** T13 §3.6 label (the headline). */
  label: string;
  /** One line telling the operator what to do next. */
  action: string;
  /** Fixed dwell before the screen clears back to scan-ready: informational fast, "route them to the desk" slow. */
  dwellMs: number;
};

export const OUTCOME_SPEC: Record<ScanOutcome, OutcomeSpec> = {
  VALID: { icon: CircleCheck, tone: "success", label: "Acceso válido", action: "Puede pasar.", dwellMs: 2_000 },
  ALREADY_CHECKED_IN: {
    icon: Info,
    tone: "info",
    label: "Ya registrado",
    action: "Este código ya se registró antes. No se creó otro registro.",
    dwellMs: 2_800,
  },
  REVOKED_CREDENTIAL: {
    icon: ShieldX,
    tone: "danger",
    label: "Código revocado",
    action: "No lo aceptes. Envía a la persona a la mesa de atención.",
    dwellMs: 6_000,
  },
  REPLACED_CREDENTIAL: {
    icon: ShieldX,
    tone: "danger",
    label: "Este código ya no es válido, se reemplazó",
    action: "Pídele el código nuevo desde su cuenta o envíala a la mesa de atención.",
    dwellMs: 6_000,
  },
  WRONG_EVENT: {
    icon: Ban,
    tone: "danger",
    label: "Este pase no es de este evento",
    action: "Pertenece a otra edición. Revisa que la persona esté en el evento correcto.",
    dwellMs: 6_000,
  },
  REGISTRATION_NOT_CONFIRMED: {
    icon: TriangleAlert,
    tone: "warning",
    label: "Inscripción no confirmada aún",
    action: "Envía a la persona a la mesa de atención para revisar su inscripción.",
    dwellMs: 6_000,
  },
  GUARDIAN_VERIFICATION_REQUIRED: {
    icon: UserCheck,
    tone: "warning",
    label: "Requiere verificar guardián",
    action: "Verifica en persona al adulto responsable antes de continuar.",
    dwellMs: 0,
  },
  UNKNOWN_PASS: {
    icon: CircleHelp,
    tone: "danger",
    label: "Código no reconocido",
    action: "No es un pase de esta plataforma o no existe. Prueba de nuevo o busca a la persona por nombre.",
    dwellMs: 5_000,
  },
  CANCELED_REGISTRATION: {
    icon: CircleX,
    tone: "danger",
    label: "Inscripción cancelada",
    action: "La inscripción ya no está vigente. Envía a la persona a la mesa de atención.",
    dwellMs: 6_000,
  },
  NOT_YET_ALLOWED: {
    icon: Clock,
    tone: "warning",
    label: "Aún no es hora de ingreso",
    action: "Todavía no abre el ingreso. Pídele que regrese en el horario indicado.",
    dwellMs: 5_000,
  },
  OTHER_REVIEW: {
    icon: Flag,
    tone: "warning",
    label: "Revisar manualmente",
    action: "El sistema no puede resolverlo solo. Envía a la persona a la mesa de atención.",
    dwellMs: 8_000,
  },
};

export function isScanOutcome(value: unknown): value is ScanOutcome {
  return typeof value === "string" && (SCAN_OUTCOMES as readonly string[]).includes(value);
}

export type ScanOperation = "EVENT_CHECKIN" | "KIT_PICKUP";

export const OPERATION_LABEL: Record<ScanOperation, string> = {
  EVENT_CHECKIN: "Check-in",
  KIT_PICKUP: "Entrega de kits",
};

/**
 * Operation-specific wording on top of the T13 label (the label itself never changes): the same server outcome
 * reads differently for a kit desk ("Ya registrado" is a second delivery, J4 step 6 "Ya entregado").
 */
export function outcomeDetail(outcome: ScanOutcome, operation: ScanOperation): string | null {
  if (operation !== "KIT_PICKUP") return outcome === "VALID" ? "Llegada registrada." : null;
  switch (outcome) {
    case "VALID":
      return "Kit entregado.";
    case "ALREADY_CHECKED_IN":
      return "Ya entregado. No se entrega otro kit.";
    case "OTHER_REVIEW":
      return "Sin kit asignado, fuera de la ventana de entrega o en otro estado: revisa en la mesa de kits.";
    case "NOT_YET_ALLOWED":
      return "La entrega de este kit todavía no abre.";
    default:
      return null;
  }
}
