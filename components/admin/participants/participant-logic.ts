import { isRouteAvailable } from "@/components/shell/nav-availability";
import { CANCEL_REASON_CATEGORIES, CANCEL_REASON_LABELS, type CancelNotification, type CancelReasonCategory, type ChangeModalityResult } from "@/lib/shared/closure";

/**
 * Pure logic of participant administration (Master §77-79, §172; OWN-04). The server decides: this module shapes requests,
 * validates what is obviously incomplete before sending, and turns the server's answers (cancel notification outcome, distance impact,
 * CLOSURE_BLOCKED, modality refusals) into copy. It never decides whether an action is allowed.
 */
export type ParticipantRowView = {
  registration_id: string;
  registration_number: string;
  status: string;
  confirmed_at: string | null;
  participant_kind: "PROFILE" | "GUEST";
  full_name: string | null;
  buyer_full_name: string;
  registration_request_id: string;
  modality: { modality_id: string; name: string };
  category: { category_id: string; name: string } | null;
  is_minor: boolean;
  guardian_verification_status: string | null;
  pass: { participant_pass_id: string; public_code: string; status: string; has_active_credential: boolean } | null;
  kit: { status: string; variant_label: string } | null;
  attendance: { checked_in: boolean; resolution_status: string | null };
  contact: { phone_e164: string | null; emergency_contact_name: string | null; emergency_contact_phone_e164: string | null } | null;
};

export type ModalityOption = { modality_id: string; name: string; status: string };
export type CategoryOption = { category_id: string; name: string; assignment_mode: string; active: boolean; modality_ids: readonly string[] };

export const REGISTRATION_STATUS_LABEL: Record<string, string> = { CONFIRMED: "Confirmada", CANCELED: "Cancelada" };
export const KIND_LABEL: Record<string, string> = { PROFILE: "Cuenta", GUEST: "Invitado" };
export const PASS_STATUS_LABEL: Record<string, string> = { ACTIVE: "Activo", CANCELED: "Cancelado", REVOKED: "Revocado", REPLACED: "Reemplazado" };
export const ATTENDANCE_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  PRESENT: "Presente",
  NO_SHOW: "No se presentó",
  EXCLUDED: "Excluido",
};
export const GUARDIAN_LABEL: Record<string, string> = { PENDING: "Tutor por verificar", VERIFIED: "Tutor verificado", REJECTED: "Tutor rechazado" };

export function displayName(row: Pick<ParticipantRowView, "full_name" | "registration_number">): string {
  return row.full_name?.trim() || `Inscripción ${row.registration_number}`;
}

export function canCancelRegistration(row: Pick<ParticipantRowView, "status">): boolean {
  return row.status === "CONFIRMED";
}

export function canChangeModality(row: Pick<ParticipantRowView, "status">, options: readonly ModalityOption[], current: string): boolean {
  return row.status === "CONFIRMED" && targetModalities(options, current).length > 0;
}

/** Modalities a registration can move to: ACTIVE and not the current one. The server checks capacity, eligibility and forms. */
export function targetModalities(options: readonly ModalityOption[], currentModalityId: string): ModalityOption[] {
  return options.filter((option) => option.status === "ACTIVE" && option.modality_id !== currentModalityId);
}

/** Categories the staff member must choose from for a target modality (USER_SELECTS only; system-derived ones are assigned by the server). */
export function selectableCategories(categories: readonly CategoryOption[], modalityId: string): CategoryOption[] {
  return categories.filter((category) => category.active && category.assignment_mode === "USER_SELECTS" && category.modality_ids.includes(modalityId));
}

// ---- Cancel registration (OWN-04) -------------------------------------------------------------------------------------------------

export const CANCEL_CATEGORY_OPTIONS: readonly { value: CancelReasonCategory; label: string }[] = CANCEL_REASON_CATEGORIES.map((value) => ({
  value,
  label: CANCEL_REASON_LABELS[value],
}));

export type CancelForm = { category: string; reason: string };
export type CancelErrors = { category?: string; reason?: string };

export function validateCancel(form: CancelForm): { ok: true; body: { reason: string; reason_category: CancelReasonCategory } } | { ok: false; errors: CancelErrors } {
  const errors: CancelErrors = {};
  const category = CANCEL_REASON_CATEGORIES.find((value) => value === form.category);
  if (!category) errors.category = "Elige la categoría: es lo que verá el participante en su correo.";
  const reason = form.reason.trim();
  if (reason.length === 0) errors.reason = "Escribe el motivo interno: queda en la auditoría.";
  else if (reason.length > 500) errors.reason = "Máximo 500 caracteres.";
  if (errors.category || errors.reason || !category) return { ok: false, errors };
  return { ok: true, body: { reason, reason_category: category } };
}

export type NotificationCopy = { tone: "success" | "warning" | "info"; title: string; message: string; followUp: boolean };

/** What happened to the participant's email (P3-R): shown AFTER the server confirmed the cancellation. */
export function notificationCopy(notification: CancelNotification, subject: "participant" | "buyer"): NotificationCopy {
  const who = subject === "buyer" ? "al comprador (el invitado no tiene cuenta)" : "al participante";
  switch (notification.status) {
    case "queued":
      return { tone: "success", title: "Correo en cola", message: `Se enviará un correo ${who} con el motivo elegido. Sale en unos minutos.`, followUp: false };
    case "suppressed":
      return {
        tone: "warning",
        title: "El correo no se enviará",
        message: `El contacto ${subject === "buyer" ? "del comprador" : "del participante"} está en la lista de supresión (rebotes o quejas). Avísale por otro medio; se abrió una tarea de seguimiento.`,
        followUp: true,
      };
    case "no_contact":
      return {
        tone: "warning",
        title: "No hay correo al que avisar",
        message: `No hay un correo registrado ${subject === "buyer" ? "para el comprador" : "para el participante"}. Avísale por otro medio; se abrió una tarea de seguimiento.`,
        followUp: true,
      };
    default:
      return {
        tone: "info",
        title: "No pudimos confirmar el correo",
        message: "La cancelación sí se aplicó. No pudimos leer ahora el estado del correo; el sistema abrirá una tarea de seguimiento si hace falta.",
        followUp: false,
      };
  }
}

/**
 * Where the attendance desk lives, when this build has one: the Edition-scoped page first, then the cross-Edition one. `null` when neither
 * is built yet, so the UI never links to a page that does not exist.
 */
export function attendanceHref(editionId: string, available: (route: string) => boolean = isRouteAvailable): string | null {
  if (available("/admin/eventos/[editionId]/asistencia")) return `/admin/eventos/${editionId}/asistencia`;
  if (available("/admin/asistencia")) return `/admin/asistencia?edition_id=${editionId}`;
  return null;
}

export type BlockedCopy = { title: string; message: string; reopen: "finalization" | "closure" } | null;

/** CLOSURE_BLOCKED on cancel or change modality: attendance finalized, or the Edition closed. Both say what to do first. */
export function closureBlockedCopy(failure: { code: string; details?: Record<string, unknown> | null }): BlockedCopy {
  if (failure.code !== "CLOSURE_BLOCKED") return null;
  const reason = failure.details?.reason;
  if (reason === "edition_closed") {
    return {
      title: "La edición está cerrada",
      message: "Con la edición cerrada no se puede cancelar ni cambiar de modalidad. Un administrador global debe reabrir el cierre y después la finalización de asistencia.",
      reopen: "closure",
    };
  }
  return {
    title: "La asistencia ya está finalizada",
    message: "Para cancelar o cambiar de modalidad hay que reabrir primero la finalización de asistencia. Hazlo en la sección de Asistencia y vuelve aquí.",
    reopen: "finalization",
  };
}

// ---- Change modality ---------------------------------------------------------------------------------------------------------------

export type ChangeForm = { modalityId: string; categoryId: string; reason: string };
export type ChangeErrors = { modality?: string; category?: string; reason?: string };

export function validateChange(
  form: ChangeForm,
  currentModalityId: string,
  categories: readonly CategoryOption[],
): { ok: true; body: { new_modality_id: string; category_id?: string; reason: string } } | { ok: false; errors: ChangeErrors } {
  const errors: ChangeErrors = {};
  if (!form.modalityId) errors.modality = "Elige la modalidad nueva.";
  else if (form.modalityId === currentModalityId) errors.modality = "Elige una modalidad distinta a la actual.";
  const needsCategory = form.modalityId !== "" && selectableCategories(categories, form.modalityId).length > 0;
  if (needsCategory && !form.categoryId) errors.category = "Esta modalidad pide elegir una categoría.";
  const reason = form.reason.trim();
  if (reason.length === 0) errors.reason = "Escribe el motivo: queda en la auditoría.";
  else if (reason.length > 500) errors.reason = "Máximo 500 caracteres.";
  if (errors.modality || errors.category || errors.reason) return { ok: false, errors };
  return { ok: true, body: { new_modality_id: form.modalityId, ...(needsCategory ? { category_id: form.categoryId } : {}), reason } };
}

function km(meters: number | null): string {
  return meters === null ? "sin distancia oficial" : `${(meters / 1000).toLocaleString("es-MX", { maximumFractionDigits: 3 })} km`;
}

/** The official-distance impact (Master §79), only when something actually changes; null otherwise. */
export function distanceImpactText(impact: ChangeModalityResult["official_distance_impact"]): string | null {
  const distanceChanged = impact.from_m !== impact.to_m;
  const creditChanged = impact.from_generates_credit !== impact.to_generates_credit;
  if (!distanceChanged && !creditChanged) return null;
  const parts: string[] = [];
  if (distanceChanged) parts.push(`La distancia oficial pasa de ${km(impact.from_m)} a ${km(impact.to_m)}.`);
  if (creditChanged) {
    parts.push(
      impact.to_generates_credit
        ? "La modalidad nueva sí genera crédito de distancia."
        : "La modalidad nueva no genera crédito de distancia.",
    );
  }
  return parts.join(" ");
}

const ELIGIBILITY_REASON: Record<string, string> = {
  MODALITY_RULE: "no cumple la regla de edad o sexo de la modalidad",
  CATEGORY_RULE: "no cumple la regla de la categoría",
  NO_CATEGORY_MATCH: "no encaja en ninguna categoría de la modalidad",
};

export type ChangeFailureCopy = { title: string; message: string; lines: string[] } | null;

/** Refusals specific to a modality change (P3-C contract table). `null` lets the shared error model speak. */
export function changeFailureCopy(failure: { code: string; details?: Record<string, unknown> | null }): ChangeFailureCopy {
  const d = failure.details ?? {};
  if (failure.code === "FORM_INVALID") {
    if (d.field_key === "category_id") {
      return {
        title: "Falta la categoría",
        message: d.reason === "invalid_category" ? "La categoría elegida no pertenece a la modalidad nueva." : "La modalidad nueva pide elegir una categoría.",
        lines: [],
      };
    }
    return {
      title: "La modalidad nueva pide una respuesta que falta",
      message: "El formulario de la modalidad nueva exige un dato que esta inscripción nunca dio. Desde aquí no se puede completar: pídele al participante que se inscriba en la modalidad nueva.",
      lines: [],
    };
  }
  if (failure.code === "PARTICIPANT_NOT_ELIGIBLE") {
    const reasons = Array.isArray(d.reasons) ? d.reasons.filter((value): value is string => typeof value === "string") : [];
    return {
      title: "No es elegible para la modalidad nueva",
      message: "El participante no cumple las reglas de la modalidad nueva.",
      lines: reasons.map((code) => `El participante ${ELIGIBILITY_REASON[code] ?? "no cumple una regla de elegibilidad"}.`),
    };
  }
  if (failure.code === "VALIDATION_ERROR" && d.field === "new_modality_id" && d.reason === "same_as_current") {
    return { title: "Es la misma modalidad", message: "Elige una modalidad distinta a la actual.", lines: [] };
  }
  return null;
}

export function cancelFailureCopy(failure: { code: string; details?: Record<string, unknown> | null }): { title: string; message: string } | null {
  if (failure.code === "CONFLICT" && failure.details?.reason === "invalid_transition") {
    return { title: "La inscripción ya no está confirmada", message: "Ya estaba cancelada o cambió de estado. Actualiza la pantalla para ver el estado actual." };
  }
  return null;
}

// ---- Display helpers ---------------------------------------------------------------------------------------------------------------

export function attendanceText(row: Pick<ParticipantRowView, "attendance">): string {
  const status = row.attendance.resolution_status;
  return status ? (ATTENDANCE_LABEL[status] ?? status) : "Sin resolver";
}

/** Phone numbers are shown only when the API sent a contact block for this role. */
export function hasContact(rows: readonly Pick<ParticipantRowView, "contact">[]): boolean {
  return rows.some((row) => row.contact !== null);
}

/** File name the browser should save a CSV under, from the server's Content-Disposition (falls back to a safe name). */
export function csvFileName(contentDisposition: string | null): string {
  const match = contentDisposition ? /filename="([A-Za-z0-9._-]+)"/.exec(contentDisposition) : null;
  return match?.[1] ?? "participantes.csv";
}

/** Query of the CSV export: the active filters plus the mandatory reason (3..500). Never includes the cursor or paging. */
export function exportQuery(filters: Record<string, string | undefined>, reason: string): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) query.set(name, value);
  query.set("reason", reason.trim());
  return query.toString();
}

export function validateExportReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < 3) return "Escribe por qué exportas (mínimo 3 caracteres): queda registrado.";
  if (trimmed.length > 500) return "Máximo 500 caracteres.";
  return null;
}
