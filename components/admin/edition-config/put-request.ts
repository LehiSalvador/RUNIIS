import { toApiResult, type ApiResult } from "@/lib/client/api";
import type { JsonObject } from "@/lib/shared/api-contract";

/**
 * PUT with the same envelope handling as `apiFetch`. The shared client (lib/client/api.ts) types `method` as GET | POST | PATCH |
 * DELETE, and the form-fields endpoint is a PUT (PUT /api/v1/admin/forms/:formId/fields). It is built on the shared `toApiResult`,
 * so a transport failure or an unparseable body becomes the same synthetic NETWORK_ERROR and never throws.
 */
export async function apiPut<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return toApiResult<T>(0, null);
  }
  const parsed: unknown = await response.json().catch(() => null);
  return toApiResult<T, JsonObject>(response.status, parsed);
}
