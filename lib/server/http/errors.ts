import "server-only";
import { ERROR_CATALOG, type ErrorCode, type JsonObject } from "@/lib/shared/api-contract";
import { logEvent } from "../log";

export { ERROR_CATALOG, isErrorCode, type ErrorCode } from "@/lib/shared/api-contract";

/** A failure that is safe to show to the client. Never put SQL, stack or secret text in it. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: JsonObject;
  readonly publicMessage: string;

  constructor(code: ErrorCode, options: { details?: JsonObject; message?: string; cause?: unknown } = {}) {
    super(code, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details ?? {};
    this.publicMessage = options.message ?? ERROR_CATALOG[code].message;
  }

  get status(): number {
    return ERROR_CATALOG[this.code].status;
  }
}

/** Converts anything thrown into an AppError; unexpected errors are logged by name only. */
export function toAppError(error: unknown, context: Record<string, string> = {}): AppError {
  if (error instanceof AppError) return error;
  logEvent("error", "unhandled_error", {
    ...context,
    error_name: error instanceof Error ? error.name : typeof error,
  });
  return new AppError("INTERNAL_ERROR");
}
