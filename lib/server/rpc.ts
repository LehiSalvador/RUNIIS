import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { ErrorCode, JsonObject } from "@/lib/shared/api-contract";
import { AppError, isErrorCode } from "./http/errors";
import { logEvent } from "./log";

type PostgrestErrorLike = { code?: string | null; message?: string | null; details?: string | null };

const CODE_SHAPE = /^[A-Z][A-Z0-9_]{2,63}$/;

// SQLSTATE / PostgREST codes that have a meaning of their own. Everything else is INTERNAL_ERROR.
const INFRASTRUCTURE_CODES: Record<string, ErrorCode> = {
  "42501": "FORBIDDEN", // insufficient_privilege: missing grant or RLS denial
  "23505": "CONFLICT", // unique_violation that a command did not translate (double submit race)
  "40001": "CONFLICT", // serialization_failure
  "40P01": "CONFLICT", // deadlock_detected
  "57014": "DEPENDENCY_UNAVAILABLE", // statement timeout / cancel
  PGRST301: "AUTH_REQUIRED", // JWT invalid or expired
  PGRST302: "AUTH_REQUIRED",
  PGRST303: "AUTH_REQUIRED",
};
const RETRYABLE_CODES = new Set(["40001", "40P01"]);

/**
 * Calls `public.<fn>` and validates the result. Domain failures raised as
 * `errcode 'P0001', message '<CODE>', detail '<json>'` (ADR-001 §4) become AppError(CODE, detail);
 * the detail JSON is forwarded to the client, so commands must only put client-safe data in it.
 */
export async function callRpc<S extends z.ZodType>(
  client: SupabaseClient,
  fn: string,
  args: JsonObject,
  resultSchema: S,
): Promise<z.output<S>> {
  const { data, error, status } = await client.rpc(fn, args);
  if (error) throw mapRpcError(fn, error, status);
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    logEvent("error", "rpc_result_invalid", { rpc: fn });
    throw new AppError("INTERNAL_ERROR");
  }
  return parsed.data;
}

export function mapRpcError(fn: string, error: PostgrestErrorLike, httpStatus: number): AppError {
  const pgCode = error.code ?? "";

  if (pgCode === "P0001") {
    const domainCode = error.message ?? "";
    if (isErrorCode(domainCode)) return new AppError(domainCode, { details: parseDetails(error.details) });
    // Raise text that is not a catalogued code may contain interpolated data: log its shape only.
    logEvent("error", "rpc_unknown_domain_code", { rpc: fn, domain_code: CODE_SHAPE.test(domainCode) ? domainCode : "<non-code>" });
    return new AppError("INTERNAL_ERROR");
  }

  const mapped: ErrorCode | undefined =
    INFRASTRUCTURE_CODES[pgCode] ?? (pgCode === "" && (httpStatus === 0 || httpStatus >= 502) ? "DEPENDENCY_UNAVAILABLE" : undefined);

  logEvent(mapped === "CONFLICT" ? "warn" : "error", "rpc_error", { rpc: fn, pg_code: pgCode || null, http_status: httpStatus, mapped_to: mapped ?? "INTERNAL_ERROR" });
  if (RETRYABLE_CODES.has(pgCode)) return new AppError("CONFLICT", { details: { retryable: true } });
  return new AppError(mapped ?? "INTERNAL_ERROR");
}

function parseDetails(raw: string | null | undefined): JsonObject {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}
