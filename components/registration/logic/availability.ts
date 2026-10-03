import type { StatusBadgeState } from "@/components/ui/status-badge";
import type { RegistrationContext } from "@/lib/shared/registration-context";
import { noRegistrableModality } from "./model";

// Read-only states of /inscripcion/[slug] (ux-spec J7 CTA table + §5 copy rules 2-3, P2-B contract §2).
// All of them are derived from the server context: the browser never decides that registration is closed
// or that a modality is sold out. "Agotado" is reserved for confirmed registrations exhausting capacity;
// a hold-only block is "Temporalmente no disponible".

export type BlockedState = {
  badge: StatusBadgeState;
  title: string;
  body: string;
  /** Re-reading the context may change the answer (holds release, window opens). */
  canRefresh: boolean;
};

export function blockedState(ctx: RegistrationContext, formatDate: (iso: string) => string = (iso) => iso): BlockedState | null {
  const { edition, registration } = ctx;

  if (!registration.can_register) {
    if (edition.execution_state === "CANCELED") {
      return { badge: "CANCELED", title: "Este evento fue cancelado", body: "Ya no se aceptan inscripciones.", canRefresh: false };
    }
    if (edition.execution_state === "POSTPONED") {
      return { badge: "POSTPONED", title: "Este evento fue aplazado", body: "Por ahora no se aceptan inscripciones. Consulta la página del evento para ver novedades.", canRefresh: true };
    }
    switch (registration.blocking_code) {
      case "REGISTRATION_NOT_OPEN":
        if (edition.registration_state === "PAUSED") {
          return { badge: "TEMPORARILY_UNAVAILABLE", title: "Las inscripciones están en pausa", body: "Las inscripciones están en pausa por el momento. Vuelve a consultar más tarde.", canRefresh: true };
        }
        return {
          badge: "NOT_OPEN",
          title: "Las inscripciones aún no abren",
          body: registration.opens_at ? `Abren el ${formatDate(registration.opens_at)} (hora local del evento).` : "La fecha de apertura de inscripciones aún no se publica.",
          canRefresh: true,
        };
      case "REGISTRATION_CLOSED":
        return { badge: "CLOSED", title: "Las inscripciones ya cerraron", body: "Ya no se aceptan inscripciones para esta edición.", canRefresh: false };
      default:
        return { badge: "CLOSED", title: "Este evento no admite inscripciones en este momento", body: "Consulta la página del evento para más información.", canRefresh: true };
    }
  }

  if (noRegistrableModality(ctx)) {
    const states = ctx.modalities.map((modality) => modality.availability_state);
    if (states.includes("TEMPORARILY_UNAVAILABLE")) {
      return {
        badge: "TEMPORARILY_UNAVAILABLE",
        title: "Temporalmente no disponible",
        body: "Los lugares restantes están apartados por solicitudes en proceso y podrían liberarse. Vuelve a consultar más tarde.",
        canRefresh: true,
      };
    }
    if (states.length > 0 && states.every((state) => state === "SOLD_OUT")) {
      return { badge: "SOLD_OUT", title: "Agotado", body: "Ya no quedan lugares disponibles para esta edición.", canRefresh: false };
    }
    return { badge: "CLOSED", title: "Ninguna modalidad está disponible", body: "Por ahora no hay modalidades abiertas para inscribirse.", canRefresh: true };
  }
  return null;
}
