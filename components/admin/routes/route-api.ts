import { apiFetch, type ApiResult } from "@/lib/client/api";
import type { JsonObject } from "@/lib/shared/api-contract";
import type { RevisionFull, RouteRow, ValidationResult } from "@/components/admin/routes/route-geometry";

/**
 * The staff route editor's calls to the existing admin API (T32). Every function returns the shared `ApiResult`: it never throws, a
 * transport failure is the synthetic NETWORK_ERROR, and the caller shows success only for `ok: true`. Creating commands carry one
 * Idempotency-Key per user intent (the dialogs mint it once per open and reuse it on retry).
 */
export function createRoute(editionId: string, body: { name: string; modality_ids: string[] }, idempotencyKey: string): Promise<ApiResult<RouteRow>> {
  return apiFetch<RouteRow>(`/api/v1/admin/editions/${editionId}/routes`, { method: "POST", body, idempotencyKey });
}

export function duplicateRoute(routeId: string, body: { name?: string; modality_ids?: string[] }, idempotencyKey: string): Promise<ApiResult<RouteRow>> {
  return apiFetch<RouteRow>(`/api/v1/admin/routes/${routeId}/duplicate`, { method: "POST", body, idempotencyKey });
}

export function importGpx(routeId: string, body: { source_filename: string; gpx_base64: string }, idempotencyKey: string): Promise<ApiResult<RevisionFull>> {
  return apiFetch<RevisionFull>(`/api/v1/admin/routes/${routeId}/import-gpx`, { method: "POST", body, idempotencyKey });
}

export function createRevision(routeId: string, body: JsonObject, idempotencyKey: string): Promise<ApiResult<RevisionFull>> {
  return apiFetch<RevisionFull>(`/api/v1/admin/routes/${routeId}/revisions`, { method: "POST", body, idempotencyKey });
}

export function saveRevision(revisionId: string, body: JsonObject): Promise<ApiResult<RevisionFull>> {
  return apiFetch<RevisionFull>(`/api/v1/admin/route-revisions/${revisionId}`, { method: "PATCH", body });
}

export function validateRevision(revisionId: string): Promise<ApiResult<ValidationResult>> {
  return apiFetch<ValidationResult>(`/api/v1/admin/route-revisions/${revisionId}/validate`, { method: "POST" });
}

export function publishRevision(revisionId: string, idempotencyKey: string): Promise<ApiResult<RevisionFull>> {
  return apiFetch<RevisionFull>(`/api/v1/admin/route-revisions/${revisionId}/publish`, { method: "POST", idempotencyKey });
}
