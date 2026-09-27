import "server-only";
import { NextResponse } from "next/server";
import type { ApiErrorBody, ApiSuccess, JsonObject } from "@/lib/shared/api-contract";
import { AppError } from "./errors";
import { REQUEST_ID_HEADER } from "./request-id";

export function successResponse<T>(
  requestId: string,
  data: T,
  options: { meta?: JsonObject; status?: number; headers?: HeadersInit } = {},
): NextResponse<ApiSuccess<T>> {
  const response = NextResponse.json({ data, meta: options.meta ?? {} }, { status: options.status ?? 200, headers: options.headers });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function errorResponse(requestId: string, error: AppError): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    error: { code: error.code, message: error.publicMessage, request_id: requestId, details: error.details },
  };
  const response = NextResponse.json(body, { status: error.status });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Cache-Control", "no-store");
  const retryAfter = error.details.retry_after_seconds;
  if (error.code === "RATE_LIMITED" && typeof retryAfter === "number" && retryAfter > 0) {
    response.headers.set("Retry-After", String(Math.ceil(retryAfter)));
  }
  return response;
}
