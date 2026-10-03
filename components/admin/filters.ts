/**
 * Pure URL-state helpers for admin list filters (ui-spec §3.14: filter state lives in the query string
 * so back, forward and shared links reproduce the same view). Client-safe, used by FilterBar and by the
 * server pages that parse the same query.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** First value of a query param as a trimmed string, or undefined when absent/blank. */
export function firstParam(params: RawSearchParams, name: string): string | undefined {
  const raw = params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** A param restricted to an allow-list; anything else (typos, injected values) is treated as absent. */
export function enumParam<T extends string>(params: RawSearchParams, name: string, allowed: readonly T[]): T | undefined {
  const value = firstParam(params, name);
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Next query string after changing some filters: `changes[name] === null|""` removes it, and the paging
 * `cursor` always resets (a new filter must start from the first page).
 */
export function nextQuery(current: URLSearchParams | string, changes: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams(typeof current === "string" ? current : current.toString());
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value.trim() === "") params.delete(name);
    else params.set(name, value.trim());
  }
  params.delete("cursor");
  return params.toString();
}

export function withQuery(pathname: string, query: string): string {
  return query ? `${pathname}?${query}` : pathname;
}
