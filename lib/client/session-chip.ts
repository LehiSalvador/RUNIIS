/**
 * Public header session chip (ADR-001 A9 / SEC-052): cached public pages never read cookies, so the
 * chip is resolved in the browser from GET /api/v1/me. Anything but a 200 with a `data` object --
 * 401 for visitors, 404 before the route ships, network errors -- degrades to the anonymous "Entrar"
 * chip; it never blocks the page. The response shape is read defensively (T20 owns the contract).
 */
export type SessionChipState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; displayName: string; avatarUrl: string | null };

type MeBody = {
  data?: {
    display_name?: unknown;
    avatar_url?: unknown;
    profile?: { display_name?: unknown; avatar_url?: unknown } | null;
  } | null;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function toSessionChipState(httpStatus: number, body: unknown): SessionChipState {
  if (httpStatus !== 200 || typeof body !== "object" || body === null) return { status: "anonymous" };
  const data = (body as MeBody).data;
  if (typeof data !== "object" || data === null) return { status: "anonymous" };

  return {
    status: "authenticated",
    displayName: asText(data.display_name) ?? asText(data.profile?.display_name) ?? "Mi cuenta",
    avatarUrl: asText(data.avatar_url) ?? asText(data.profile?.avatar_url),
  };
}

export async function fetchSessionChipState(signal?: AbortSignal): Promise<SessionChipState> {
  try {
    const response = await fetch("/api/v1/me", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    const body: unknown = response.status === 200 ? await response.json().catch(() => null) : null;
    return toSessionChipState(response.status, body);
  } catch {
    return { status: "anonymous" };
  }
}
