/**
 * Pure helpers for DateInput (ui-spec §3.1): the visible value is Spanish dd/mm/aaaa, the value
 * exchanged with callers/APIs is ISO yyyy-mm-dd. Typing only inserts the separators; an impossible
 * or incomplete date is reported as invalid, never silently corrected.
 */

const DISPLAY_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Keeps at most 8 digits and inserts "/" after the day and month groups. */
export function maskDateDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** "dd/mm/aaaa" -> "yyyy-mm-dd", or null when incomplete or not a real calendar date. */
export function displayToIso(display: string): string | null {
  const match = DISPLAY_PATTERN.exec(display);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  if (!isRealDate(Number(yyyy), Number(mm), Number(dd))) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** "yyyy-mm-dd" -> "dd/mm/aaaa"; anything else -> "". */
export function isoToDisplay(iso: string | null | undefined): string {
  const match = iso ? ISO_PATTERN.exec(iso) : null;
  if (!match) return "";
  const [, yyyy, mm, dd] = match;
  return `${dd}/${mm}/${yyyy}`;
}
