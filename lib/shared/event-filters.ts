// /eventos URL state (Master §54-55): filters and search live in query params, so back/forward and
// shared links reproduce the same view. Parsing is lenient (a stale or hand-edited URL degrades to
// "that filter is ignored", never to an error page) and mirrors the bounds of
// searchEditionsQuerySchema so the server call never fails on a URL the UI produced.

export const LIBRARY_PAGE_SIZE = 6;

export type PriceFilter = "FREE" | "PAID";

export type EventFilters = {
  q: string | null;
  type: string[];
  date_from: string | null;
  date_to: string | null;
  distance_min_m: number | null;
  distance_max_m: number | null;
  location: string | null;
  price: PriceFilter[];
  registration_open: boolean;
};

export const EMPTY_FILTERS: EventFilters = {
  q: null,
  type: [],
  date_from: null,
  date_to: null,
  distance_min_m: null,
  distance_max_m: null,
  location: null,
  price: [],
  registration_open: false,
};

/** Non-overlapping ranges over official Modality distances (meters). */
export const DISTANCE_PRESETS = [
  { key: "hasta-5k", label: "Hasta 5 km", min: null, max: 5000 },
  { key: "5k-10k", label: "Más de 5 y hasta 10 km", min: 5001, max: 10000 },
  { key: "10k-21k", label: "Más de 10 km y hasta medio maratón", min: 10001, max: 21097 },
  { key: "21k-mas", label: "Más de medio maratón", min: 21098, max: null },
] as const;

export const PRICE_OPTIONS: { value: PriceFilter; label: string }[] = [
  { value: "FREE", label: "Gratis" },
  { value: "PAID", label: "De pago" },
];

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

const TYPE_KEY = /^[A-Z][A-Z0-9_]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 160;

function all(params: RawParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function first(params: RawParams, key: string): string | null {
  return all(params, key)[0] ?? null;
}

function text(value: string | null): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, MAX_TEXT);
}

export function isRealIsoDate(value: string | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function meters(value: string | null): number | null {
  if (value === null || !/^\d{1,7}$/.test(value)) return null;
  const n = Number(value);
  return n <= 1_000_000 ? n : null;
}

export function parseEventFilters(params: RawParams): EventFilters {
  const type = [...new Set(all(params, "type").filter((key) => key.length <= 64 && TYPE_KEY.test(key)))].slice(0, 20);
  const price = [...new Set(all(params, "price").filter((v): v is PriceFilter => v === "FREE" || v === "PAID"))];
  let dateFrom = first(params, "date_from");
  let dateTo = first(params, "date_to");
  dateFrom = isRealIsoDate(dateFrom) ? dateFrom : null;
  dateTo = isRealIsoDate(dateTo) ? dateTo : null;
  if (dateFrom && dateTo && dateTo < dateFrom) dateTo = null;
  const min = meters(first(params, "distance_min_m"));
  let max = meters(first(params, "distance_max_m"));
  if (min !== null && max !== null && max < min) max = null;

  return {
    q: text(first(params, "q")),
    type,
    date_from: dateFrom,
    date_to: dateTo,
    distance_min_m: min,
    distance_max_m: max,
    location: text(first(params, "location")),
    price,
    registration_open: first(params, "registration_open") === "true",
  };
}

/** Stable, canonical ordering so equal filter states produce equal URLs (and cache keys). */
export function toQueryString(filters: EventFilters, extra?: Record<string, string>): string {
  const search = new URLSearchParams();
  if (filters.q) search.set("q", filters.q);
  for (const key of [...filters.type].sort()) search.append("type", key);
  if (filters.date_from) search.set("date_from", filters.date_from);
  if (filters.date_to) search.set("date_to", filters.date_to);
  if (filters.distance_min_m !== null) search.set("distance_min_m", String(filters.distance_min_m));
  if (filters.distance_max_m !== null) search.set("distance_max_m", String(filters.distance_max_m));
  if (filters.location) search.set("location", filters.location);
  for (const value of [...filters.price].sort()) search.append("price", value);
  if (filters.registration_open) search.set("registration_open", "true");
  for (const [key, value] of Object.entries(extra ?? {})) search.set(key, value);
  return search.toString();
}

export function libraryHref(filters: EventFilters): string {
  const query = toQueryString(filters);
  return query ? `/eventos?${query}` : "/eventos";
}

/** Number of filter dimensions in use (the search box is not a filter). */
export function activeFilterCount(filters: EventFilters): number {
  return (
    (filters.type.length > 0 ? 1 : 0) +
    (filters.date_from || filters.date_to ? 1 : 0) +
    (filters.distance_min_m !== null || filters.distance_max_m !== null ? 1 : 0) +
    (filters.location ? 1 : 0) +
    (filters.price.length > 0 ? 1 : 0) +
    (filters.registration_open ? 1 : 0)
  );
}

export function distancePresetKey(filters: Pick<EventFilters, "distance_min_m" | "distance_max_m">): string | null {
  const preset = DISTANCE_PRESETS.find((p) => p.min === filters.distance_min_m && p.max === filters.distance_max_m);
  return preset?.key ?? null;
}

/** Master §56 empty variants: which one applies when a query returns nothing. */
export type EmptyVariant = "no_upcoming" | "search_no_match" | "filters_no_result";

export function emptyVariant(filters: EventFilters): EmptyVariant {
  if (activeFilterCount(filters) > 0) return "filters_no_result";
  if (filters.q) return "search_no_match";
  return "no_upcoming";
}

/** Params for searchEditions / GET /api/v1/events (arrays only when non-empty). */
export function toSearchParams(filters: EventFilters) {
  return {
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.type.length ? { type: filters.type } : {}),
    ...(filters.date_from ? { date_from: filters.date_from } : {}),
    ...(filters.date_to ? { date_to: filters.date_to } : {}),
    ...(filters.distance_min_m !== null ? { distance_min_m: filters.distance_min_m } : {}),
    ...(filters.distance_max_m !== null ? { distance_max_m: filters.distance_max_m } : {}),
    ...(filters.location ? { location: filters.location } : {}),
    ...(filters.price.length ? { price: filters.price } : {}),
    ...(filters.registration_open ? { registration_open: true } : {}),
  };
}

export type FilterChip = { id: string; label: string; remove: EventFilters };

/** Removable chips for the applied-filter row (ui-spec §3.14). */
export function filterChips(filters: EventFilters, typeLabel: (key: string) => string): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const key of filters.type) {
    chips.push({ id: `type-${key}`, label: typeLabel(key), remove: { ...filters, type: filters.type.filter((t) => t !== key) } });
  }
  if (filters.date_from || filters.date_to) {
    const label = filters.date_from && filters.date_to
      ? `Del ${formatChipDate(filters.date_from)} al ${formatChipDate(filters.date_to)}`
      : filters.date_from
        ? `Desde el ${formatChipDate(filters.date_from)}`
        : `Hasta el ${formatChipDate(filters.date_to as string)}`;
    chips.push({ id: "date", label, remove: { ...filters, date_from: null, date_to: null } });
  }
  if (filters.distance_min_m !== null || filters.distance_max_m !== null) {
    const preset = DISTANCE_PRESETS.find((p) => p.min === filters.distance_min_m && p.max === filters.distance_max_m);
    const label = preset?.label ?? `Distancia ${kmLabel(filters.distance_min_m)}–${kmLabel(filters.distance_max_m)}`;
    chips.push({ id: "distance", label, remove: { ...filters, distance_min_m: null, distance_max_m: null } });
  }
  if (filters.location) chips.push({ id: "location", label: `En ${filters.location}`, remove: { ...filters, location: null } });
  for (const value of filters.price) {
    const label = PRICE_OPTIONS.find((o) => o.value === value)?.label ?? value;
    chips.push({ id: `price-${value}`, label, remove: { ...filters, price: filters.price.filter((p) => p !== value) } });
  }
  if (filters.registration_open) {
    chips.push({ id: "open", label: "Inscripciones abiertas", remove: { ...filters, registration_open: false } });
  }
  return chips;
}

function kmLabel(value: number | null): string {
  return value === null ? "…" : `${Math.round(value / 100) / 10} km`;
}

function formatChipDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
