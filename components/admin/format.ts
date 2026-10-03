/**
 * Display formatting for staff screens. Dates are rendered in the Edition's own IANA timezone (the
 * operational truth), never the viewer's; a bare calendar date (YYYY-MM-DD) is never shifted by a zone.
 * Pure Intl, deterministic for server rendering.
 */
const LOCALE = "es-MX";

function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "America/Monterrey";
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone });
    return timeZone;
  } catch {
    return "America/Monterrey";
  }
}

/** "3 oct 2026, 14:30" in the given zone; "—" when absent or unparseable. */
export function formatDateTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: safeZone(timeZone),
  }).format(date);
}

/** "3 oct 2026" from a calendar date (YYYY-MM-DD), without any timezone shift. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return "—";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/** "06:30" from "06:30:00". */
export function formatClock(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : "—";
}

/** Calendar date plus start time when known: "3 oct 2026 · 06:30". */
export function formatSchedule(localDate: string | null | undefined, localStartTime: string | null | undefined): string {
  if (!localDate) return "Sin fecha";
  const date = formatCalendarDate(localDate);
  return localStartTime ? `${date} · ${formatClock(localStartTime)}` : date;
}
