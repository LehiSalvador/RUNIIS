/** Display formatting for the account area (es-MX, business timezone America/Monterrey). */

const TIMEZONE = "America/Monterrey";

export function formatMoney(amountMinor: number, currency: string): string {
  if (amountMinor === 0) return "Gratis";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency, minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 }).format(
    amountMinor / 100,
  );
}

/** ISO date-only ("2026-11-15") -> "15 nov 2026", read as a calendar date (no timezone shift). */
export function formatCalendarDate(isoDate: string | null | undefined, style: "short" | "long" = "short"): string {
  if (!isoDate) return "Fecha por confirmar";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    ...(style === "long" ? { weekday: "long" } : {}),
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Timestamp -> "15 nov 2026, 07:30" in the business timezone. */
export function formatDateTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export const LEGAL_DOCUMENT_LABELS: Record<string, string> = {
  TERMS_OF_SERVICE: "Términos y condiciones",
  PRIVACY_NOTICE: "Aviso de privacidad",
  SPORT_WAIVER: "Deslinde de responsabilidad deportiva",
  MINOR_TERMS: "Términos para menores de edad",
  EVENT_RULES: "Reglamento del evento",
};

export const GUARDIAN_RELATIONSHIP_LABELS: Record<string, string> = {
  PARENT: "Madre o padre",
  LEGAL_GUARDIAN: "Tutor legal",
};

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
