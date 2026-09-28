import type { StatusBadgeState } from "@/components/ui/status-badge";

// Pure presentation helpers for the public discovery surfaces (Master §54-58). Client-safe: no
// server imports, no clock reads except where a caller passes `today`. Every label here is either
// Master/UX-spec verbatim copy or a plain formatting of backend data -- nothing invented.

export type RegistrationState = "NOT_OPEN" | "OPEN" | "PAUSED" | "CLOSED";
export type ExecutionState = "SCHEDULED" | "POSTPONED" | "IN_PROGRESS" | "FINISHED" | "CANCELED";
export type AvailabilityState = "AVAILABLE" | "LOW" | "TEMPORARILY_UNAVAILABLE" | "SOLD_OUT";

export type ModalitySummary = {
  count: number;
  min_distance_m: number | null;
  max_distance_m: number | null;
  distance_varies: boolean;
  min_amount_minor: number | null;
  max_amount_minor: number | null;
  currency: string | null;
  price_varies: boolean;
  price_pending: boolean;
};

export type ScheduleRevision = {
  schedule_state: "POSTPONED_NO_NEW_DATE" | "DATE_CONFIRMED_TIME_PENDING" | "DATE_TIME_CONFIRMED";
  local_date: string | null;
  local_start_time: string | null;
} | null;

/** Seeded event_type vocabulary (supabase/migrations/..._028_seeds.sql). There is no public read of
 * event types yet, so the library filter lists the baseline set. */
export const EVENT_TYPES = [
  { key: "ROAD_RACE", label: "Carrera de ruta" },
  { key: "TRAIL", label: "Trail" },
  { key: "HIKE", label: "Senderismo" },
  { key: "WALK", label: "Caminata" },
  { key: "OTHER", label: "Otro" },
] as const;

const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PARTS = /^(\d{2}):(\d{2})/;

function isoDateToUtc(isoDate: string): Date | null {
  const match = DATE_PARTS.exec(isoDate);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

// Dates are Edition-local calendar dates ("yyyy-mm-dd"); formatting them in UTC keeps the calendar
// day exactly as published, whatever the viewer's timezone.
const LONG_DATE = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_DATE = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("es-MX", { day: "2-digit", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" });
const YEAR = new Intl.DateTimeFormat("es-MX", { year: "numeric", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export function formatLongDate(isoDate: string): string {
  const date = isoDateToUtc(isoDate);
  return date ? LONG_DATE.format(date) : isoDate;
}

export function formatShortDate(isoDate: string): string {
  const date = isoDateToUtc(isoDate);
  return date ? SHORT_DATE.format(date).replace(/\./g, "") : isoDate;
}

/** Split parts for the results-board date tile ("27", "nov", "vie", "2026"). */
export function dateTileParts(isoDate: string): { day: string; month: string; weekday: string; year: string } | null {
  const date = isoDateToUtc(isoDate);
  if (!date) return null;
  const clean = (value: string) => value.replace(/\./g, "");
  return { day: DAY.format(date), month: clean(MONTH.format(date)), weekday: clean(WEEKDAY.format(date)), year: YEAR.format(date) };
}

/** "07:00:00" -> "7:00 a.m." (Edition-local wall time, no timezone math). */
export function formatLocalTime(localTime: string): string {
  const match = TIME_PARTS.exec(localTime);
  if (!match) return localTime;
  return TIME.format(new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))));
}

const KM = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${KM.format(meters / 1000)} km`;
}

export function formatMoney(amountMinor: number, currency: string): string {
  if (amountMinor === 0) return "Gratis";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/** Master §57: when Modalities differ the card never shows one misleading single value. */
export function summarizeDistance(summary: ModalitySummary): string {
  const { count, min_distance_m: min, max_distance_m: max, distance_varies: varies } = summary;
  if (count === 0) return "Modalidades por anunciar";
  if (min === null || max === null) return count > 1 ? `${count} modalidades` : "Distancia por confirmar";
  const range = varies && min !== max ? `${formatDistance(min).replace(/ km$/, "")}–${formatDistance(max)}` : formatDistance(min);
  return count > 1 ? `${count} modalidades · ${range}` : range;
}

export function summarizePrice(summary: ModalitySummary): string {
  const { min_amount_minor: min, max_amount_minor: max, currency, price_pending: pending } = summary;
  if (summary.count === 0 || min === null || max === null || !currency) return "Precio por confirmar";
  const known = min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
  return pending ? `${known} · otras por confirmar` : known;
}

export type PublicStatus = { state: StatusBadgeState; label?: string };

/**
 * Card/page status badge. Execution outcomes win (a canceled/postponed/finished Edition never reads
 * as open), then registration state, then the availability state for OPEN registration -- the same
 * precedence as mapCta (Master §58). A hold-only block is TEMPORARILY_UNAVAILABLE, never "Agotado"
 * (Master §36, UX copy rule 2) -- that distinction is the backend's global_state, passed through.
 */
export function publicStatus(
  registration: RegistrationState,
  execution: ExecutionState,
  availability: AvailabilityState | null,
): PublicStatus {
  if (execution === "CANCELED") return { state: "CANCELED" };
  if (execution === "POSTPONED") return { state: "POSTPONED" };
  if (execution === "FINISHED") return { state: "FINISHED" };
  switch (registration) {
    case "CLOSED":
      return { state: "CLOSED" };
    case "NOT_OPEN":
      return { state: "NOT_OPEN", label: "Inscripciones próximamente" };
    case "PAUSED":
      return { state: "TEMPORARILY_UNAVAILABLE" };
    case "OPEN":
      if (availability === "SOLD_OUT") return { state: "SOLD_OUT" };
      if (availability === "TEMPORARILY_UNAVAILABLE") return { state: "TEMPORARILY_UNAVAILABLE" };
      if (availability === "LOW") return { state: "LOW" };
      return { state: "AVAILABLE", label: "Inscripciones abiertas" };
  }
}

export type ScheduleDisplay =
  | { kind: "confirmed"; date: string; time: string | null }
  | { kind: "time_pending"; date: string }
  | { kind: "postponed" }
  | { kind: "unknown" };

/** Master §29 / UX copy rule 4: a pending time is stated as pending, never rendered as 00:00. */
export function scheduleDisplay(schedule: ScheduleRevision): ScheduleDisplay {
  if (!schedule) return { kind: "unknown" };
  if (schedule.schedule_state === "POSTPONED_NO_NEW_DATE" || !schedule.local_date) {
    return schedule.schedule_state === "POSTPONED_NO_NEW_DATE" ? { kind: "postponed" } : { kind: "unknown" };
  }
  if (schedule.schedule_state === "DATE_CONFIRMED_TIME_PENDING") return { kind: "time_pending", date: schedule.local_date };
  return { kind: "confirmed", date: schedule.local_date, time: schedule.local_start_time };
}

/** Mirrors search_editions' bucket split (sport_date < current_date => past section, Master §54). */
export function isPastSportDate(sportDate: string | null, todayIso: string): boolean {
  return sportDate !== null && sportDate < todayIso;
}

export function todayIsoUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export const LOCATION_TYPE_LABEL: Record<string, string> = {
  DISCOVERY: "Punto de referencia",
  VENUE: "Sede",
  START: "Salida",
  FINISH: "Meta",
  MEETING_POINT: "Punto de reunión",
  PARKING: "Estacionamiento",
  KIT_PICKUP: "Entrega de kits",
  OTHER: "Otro punto",
};

export const POI_TYPE_LABEL: Record<string, string> = {
  START: "Salida",
  FINISH: "Meta",
  HYDRATION: "Hidratación",
  MEDICAL: "Atención médica",
  CHECKPOINT: "Punto de control",
  RESTROOM: "Sanitarios",
  VIEWPOINT: "Mirador",
  OTHER: "Punto de interés",
};

const SEX_LABEL: Record<string, string> = { F: "Mujeres", M: "Hombres", X: "No binario" };

export function describeEligibility(rules: { min_age?: number; max_age?: number; sex_codes?: string[] }): string | null {
  const parts: string[] = [];
  if (rules.min_age !== undefined && rules.max_age !== undefined) parts.push(`${rules.min_age} a ${rules.max_age} años`);
  else if (rules.min_age !== undefined) parts.push(`${rules.min_age} años o más`);
  else if (rules.max_age !== undefined) parts.push(`Hasta ${rules.max_age} años`);
  if (rules.sex_codes && rules.sex_codes.length > 0) parts.push(rules.sex_codes.map((code) => SEX_LABEL[code] ?? code).join(", "));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** wa.me link without a prefilled message: the Master §68 fixed text needs a public reference that
 * only exists after a registration request; general questions open a blank chat. */
export function whatsAppContactUrl(phoneE164: string | null): string | null {
  if (!phoneE164 || !/^\+[1-9][0-9]{7,14}$/.test(phoneE164)) return null;
  return `https://wa.me/${phoneE164.slice(1)}`;
}
