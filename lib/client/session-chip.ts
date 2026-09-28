/**
 * Public header session chip (ADR-001 A9 / SEC-052): cached public pages never read cookies, so the
 * chip is resolved in the browser from GET /api/v1/session -- a probe that always answers 200 (never
 * 401/404/5xx) and carries the state in the body instead, so an anonymous visitor's network tab
 * never shows a "failed" request. Anything but a well-formed 200 body -- network error, unexpected
 * shape -- degrades to the anonymous "Entrar" chip; it never blocks the page. The response shape is
 * read defensively (T20 owns the contract).
 */
export type SessionChipState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; displayName: string; avatarUrl: string | null };

type SessionBody = {
  data?: {
    authenticated?: unknown;
    display_name?: unknown;
    avatar_url?: unknown;
  } | null;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function toSessionChipState(httpStatus: number, body: unknown): SessionChipState {
  if (httpStatus !== 200 || typeof body !== "object" || body === null) return { status: "anonymous" };
  const data = (body as SessionBody).data;
  if (typeof data !== "object" || data === null || data.authenticated !== true) return { status: "anonymous" };

  return {
    status: "authenticated",
    displayName: asText(data.display_name) ?? "Mi cuenta",
    avatarUrl: asText(data.avatar_url),
  };
}

export async function fetchSessionChipState(signal?: AbortSignal): Promise<SessionChipState> {
  try {
    const response = await fetch("/api/v1/session", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return toSessionChipState(response.status, body);
  } catch {
    return { status: "anonymous" };
  }
}
