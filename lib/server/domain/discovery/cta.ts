import "server-only";

// Master §58 CTA mapping (verbatim strings from the UX spec J7 item 7). Pure function, unit-tested
// without a database: the Event page and the Event card both call this with the same three states.

export type RegistrationState = "NOT_OPEN" | "OPEN" | "PAUSED" | "CLOSED";
export type ExecutionState = "SCHEDULED" | "POSTPONED" | "IN_PROGRESS" | "FINISHED" | "CANCELED";
export type AvailabilityGlobalState = "AVAILABLE" | "LOW" | "TEMPORARILY_UNAVAILABLE" | "SOLD_OUT" | null;

export type CtaCode = "REGISTER" | "TEMPORARILY_UNAVAILABLE" | "SOLD_OUT" | "REMIND_ME" | "CLOSED" | "CANCELED" | "POSTPONED" | "FINISHED";

export type Cta = { code: CtaCode; label: string };

const CTA: Record<CtaCode, string> = {
  REGISTER: "Inscribirme",
  TEMPORARILY_UNAVAILABLE: "Temporalmente no disponible",
  SOLD_OUT: "Agotado",
  REMIND_ME: "Recordarme",
  CLOSED: "Inscripciones cerradas",
  CANCELED: "Evento cancelado",
  POSTPONED: "Evento aplazado",
  FINISHED: "Evento realizado",
};

function cta(code: CtaCode): Cta {
  return { code, label: CTA[code] };
}

/**
 * Master §58 order of precedence: execution_state terminal/paused states win outright (a canceled
 * or postponed or finished Edition never shows a registration CTA); otherwise registration_state
 * decides, with OPEN further split by the availability global_state (§36-37). PAUSED registration
 * is not in the Master §58 table — in practice it only co-occurs with execution_state POSTPONED
 * (KERNEL_READY.md PostponeEdition), which the branch above already catches; the PAUSED branch here
 * is a defensive fallback reusing the existing "Temporalmente no disponible" copy rather than
 * inventing new UI text.
 */
export function mapCta(registrationState: RegistrationState, executionState: ExecutionState, availabilityGlobalState: AvailabilityGlobalState): Cta {
  if (executionState === "CANCELED") return cta("CANCELED");
  if (executionState === "POSTPONED") return cta("POSTPONED");
  if (executionState === "FINISHED") return cta("FINISHED");

  switch (registrationState) {
    case "CLOSED":
      return cta("CLOSED");
    case "NOT_OPEN":
      return cta("REMIND_ME");
    case "PAUSED":
      return cta("TEMPORARILY_UNAVAILABLE");
    case "OPEN":
      if (availabilityGlobalState === "SOLD_OUT") return cta("SOLD_OUT");
      if (availabilityGlobalState === "TEMPORARILY_UNAVAILABLE") return cta("TEMPORARILY_UNAVAILABLE");
      return cta("REGISTER");
  }
}
