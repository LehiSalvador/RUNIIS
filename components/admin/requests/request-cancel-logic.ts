import { CANCEL_REASON_CATEGORIES, CANCEL_REASON_LABELS, type CancelNotification, type CancelReasonCategory } from "@/lib/shared/closure";

/**
 * Staff cancel of a PENDING request (single and bulk). Since P3-S the buyer is ALWAYS emailed (UX J2 step 4): the email names the Edition,
 * the request reference and the places released, shows only the CATEGORY label chosen here (the free-text reason never leaves staff
 * surfaces), and states that RUNIIS processes no payments on the platform. The server answers with the email outcome per request; this
 * module turns it into copy, shown only AFTER the server confirmed the cancellation.
 */
export const REQUEST_CANCEL_CATEGORY_OPTIONS: readonly { value: CancelReasonCategory; label: string }[] = CANCEL_REASON_CATEGORIES.map((value) => ({
  value,
  label: CANCEL_REASON_LABELS[value],
}));

export type RequestCancelForm = { category: string; reason: string };
export type RequestCancelErrors = { category?: string; reason?: string };

export function validateRequestCancel(
  form: RequestCancelForm,
): { ok: true; category: CancelReasonCategory; reason: string } | { ok: false; errors: RequestCancelErrors } {
  const errors: RequestCancelErrors = {};
  const category = CANCEL_REASON_CATEGORIES.find((value) => value === form.category);
  if (!category) errors.category = "Elige la categoría: es lo que verá el comprador en su correo.";
  const reason = form.reason.trim();
  if (reason.length === 0) errors.reason = "Escribe el motivo interno: queda en la auditoría.";
  else if (reason.length > 500) errors.reason = "Máximo 500 caracteres.";
  if (errors.category || errors.reason || !category) return { ok: false, errors };
  return { ok: true, category, reason };
}

/** What the buyer is told, said BEFORE the click. */
export const BUYER_EMAIL_NOTICE = {
  email: "Se enviará un correo al comprador con la categoría que elijas. El texto del motivo interno no se envía.",
  payments: "La plataforma no procesa pagos: si hubo un pago, se resuelve por fuera, directamente con el comprador.",
};

export type BuyerNotificationCopy = { tone: "success" | "warning" | "info"; title: string; message: string; followUp: boolean };

export function buyerNotificationCopy(notification: CancelNotification): BuyerNotificationCopy {
  switch (notification.status) {
    case "queued":
      return { tone: "success", title: "Correo en cola", message: "Se enviará un correo al comprador con la categoría elegida. Sale en unos minutos.", followUp: false };
    case "suppressed":
      return {
        tone: "warning",
        title: "El correo no se enviará",
        message: "El contacto del comprador está en la lista de supresión (rebotes o quejas). Avísale por otro medio; se abrió una tarea de seguimiento.",
        followUp: true,
      };
    case "no_contact":
      return {
        tone: "warning",
        title: "No hay correo al que avisar",
        message: "No hay un correo registrado para el comprador. Avísale por otro medio; se abrió una tarea de seguimiento.",
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

/** Short per-request label for the bulk result list. */
export const BUYER_NOTIFICATION_SHORT: Record<CancelNotification["status"], string> = {
  queued: "Correo en cola",
  suppressed: "Correo suprimido: seguimiento abierto",
  no_contact: "Sin correo: seguimiento abierto",
  unknown: "Correo sin confirmar",
};

/** How many canceled requests need a manual follow-up with the buyer (suppressed or no contact). */
export function followUpCount(results: readonly { notification?: CancelNotification }[]): number {
  return results.filter((row) => row.notification?.status === "suppressed" || row.notification?.status === "no_contact").length;
}
