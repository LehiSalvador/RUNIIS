import type { ErrorCode, JsonObject } from "@/lib/shared/api-contract";

/**
 * Browser-side caller for the /api/v1 envelope ({data, meta} | {error}). Never throws: a transport
 * failure or an unparseable body becomes the synthetic `NETWORK_ERROR` code so every caller maps
 * exactly one union to UI. Same-origin cookies only; no token ever lives in JS (SEC-049).
 */
export type ApiFailureCode = ErrorCode | "NETWORK_ERROR";

export type ApiFailure = {
  ok: false;
  status: number;
  code: ApiFailureCode;
  message: string;
  requestId: string | null;
  details: JsonObject;
};

export type ApiResult<T, M extends JsonObject = JsonObject> = { ok: true; status: number; data: T; meta: M } | ApiFailure;

export type ApiRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Sent as Idempotency-Key; create one per user intent (not per retry) with newIdempotencyKey(). */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function apiFetch<T, M extends JsonObject = JsonObject>(path: string, request: ApiRequest = {}): Promise<ApiResult<T, M>> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  if (request.idempotencyKey) headers["idempotency-key"] = request.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return networkFailure(0);
  }

  const body: unknown = await response.json().catch(() => null);
  return toApiResult<T, M>(response.status, body);
}

export function toApiResult<T, M extends JsonObject = JsonObject>(status: number, body: unknown): ApiResult<T, M> {
  if (body && typeof body === "object") {
    if (status < 400 && "data" in body) {
      const envelope = body as { data: T; meta?: M };
      return { ok: true, status, data: envelope.data, meta: (envelope.meta ?? {}) as M };
    }
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
      const e = error as { code: ErrorCode; message?: unknown; request_id?: unknown; details?: unknown };
      return {
        ok: false,
        status,
        code: e.code,
        message: typeof e.message === "string" ? e.message : "",
        requestId: typeof e.request_id === "string" ? e.request_id : null,
        details: e.details && typeof e.details === "object" ? (e.details as JsonObject) : {},
      };
    }
  }
  return networkFailure(status);
}

function networkFailure(status: number): ApiFailure {
  return { ok: false, status, code: "NETWORK_ERROR", message: "", requestId: null, details: {} };
}
