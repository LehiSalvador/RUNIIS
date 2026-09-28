import type { StatusBadgeState } from "@/components/ui/status-badge";
import type { RequestStatus } from "@/lib/shared/registration";

/**
 * Buyer-facing registration request states (ux-spec §5 rules 1, 3, 6): "Apartado" while pending,
 * never "pagado"; expiry is shown the moment expires_at passes, whatever the stored status says;
 * cancellations never promise refunds (payment is external).
 */
export type RequestPresentation = { badge: StatusBadgeState; label: string; summary: string };

export function presentRequest(status: RequestStatus, mode: "FREE" | "EXTERNAL_WHATSAPP"): RequestPresentation {
  switch (status) {
    case "PENDING_CONFIRMATION":
      return {
        badge: "REQUEST_PENDING",
        label: "Apartado",
        summary:
          mode === "EXTERNAL_WHATSAPP"
            ? "Tus lugares están apartados. Escríbele al organizador por WhatsApp para completar tu inscripción antes de que venza el apartado."
            : "Tus lugares están apartados mientras el organizador confirma tu inscripción.",
      };
    case "CONFIRMED":
      return {
        badge: "REGISTRATION_CONFIRMED",
        label: "Confirmada",
        summary: "Tu inscripción está confirmada. Cada participante tiene su propio pase.",
      };
    case "CANCELED_BY_BUYER":
      return { badge: "CANCELED", label: "Cancelada por ti", summary: "Cancelaste esta solicitud y los lugares se liberaron." };
    case "CANCELED_BY_STAFF":
      return {
        badge: "CANCELED",
        label: "Cancelada por el organizador",
        summary: "El organizador canceló esta solicitud. Si tienes dudas, escríbele por WhatsApp.",
      };
    case "EXPIRED":
      return {
        badge: "CLOSED",
        label: "Expirada",
        summary:
          "El apartado venció sin confirmarse y los lugares se liberaron. Si todavía quieres participar, crea una nueva solicitud desde la página del evento.",
      };
  }
}

export function isOpenRequest(status: RequestStatus): boolean {
  return status === "PENDING_CONFIRMATION";
}
