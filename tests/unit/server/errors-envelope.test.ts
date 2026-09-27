import { describe, expect, it, vi } from "vitest";
import { errorResponse, successResponse } from "@/lib/server/http/envelope";
import { AppError, ERROR_CATALOG, toAppError } from "@/lib/server/http/errors";

describe("error catalog", () => {
  it("maps the Master §178 generic taxonomy to its HTTP statuses", () => {
    expect({
      VALIDATION_ERROR: ERROR_CATALOG.VALIDATION_ERROR.status,
      AUTH_REQUIRED: ERROR_CATALOG.AUTH_REQUIRED.status,
      FORBIDDEN: ERROR_CATALOG.FORBIDDEN.status,
      NOT_FOUND: ERROR_CATALOG.NOT_FOUND.status,
      CONFLICT: ERROR_CATALOG.CONFLICT.status,
      RESOURCE_EXPIRED: ERROR_CATALOG.RESOURCE_EXPIRED.status,
      BUSINESS_RULE_VIOLATION: ERROR_CATALOG.BUSINESS_RULE_VIOLATION.status,
      RATE_LIMITED: ERROR_CATALOG.RATE_LIMITED.status,
      INTERNAL_ERROR: ERROR_CATALOG.INTERNAL_ERROR.status,
      DEPENDENCY_UNAVAILABLE: ERROR_CATALOG.DEPENDENCY_UNAVAILABLE.status,
    }).toEqual({
      VALIDATION_ERROR: 400,
      AUTH_REQUIRED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      RESOURCE_EXPIRED: 410,
      BUSINESS_RULE_VIOLATION: 422,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
      DEPENDENCY_UNAVAILABLE: 503,
    });
  });

  it("covers every specific code from Master §167 and §178", () => {
    const specific = [
      "PROFILE_INCOMPLETE", "ACCOUNT_BANNED", "IDENTITY_LOCKED", "REGISTRATION_NOT_OPEN", "REGISTRATION_CLOSED",
      "EDITION_NOT_REGISTRABLE", "MODALITY_NOT_AVAILABLE", "PARTICIPANT_NOT_ELIGIBLE", "GUARDIAN_REQUIRED",
      "DUPLICATE_REGISTRATION", "PARTICIPANT_ALREADY_HELD", "CAPACITY_UNAVAILABLE", "GLOBAL_CAPACITY_UNAVAILABLE",
      "FORM_INVALID", "LEGAL_ACCEPTANCE_REQUIRED", "REQUEST_EXPIRED", "PRICE_CHANGED", "GUARDIAN_VERIFICATION_REQUIRED",
      "AVATAR_UPLOAD_SUSPENDED", "PASS_REVOKED", "PASS_REPLACED", "ALREADY_CHECKED_IN", "CLOSURE_BLOCKED",
      "RANKING_NOT_READY", "IDEMPOTENCY_CONFLICT",
    ];
    for (const code of specific) expect(ERROR_CATALOG, code).toHaveProperty(code);
    expect(ERROR_CATALOG.CAPACITY_UNAVAILABLE.status).toBe(409);
    expect(ERROR_CATALOG.PROFILE_INCOMPLETE.status).toBe(422);
    expect(ERROR_CATALOG.IDEMPOTENCY_CONFLICT.status).toBe(409);
    expect(ERROR_CATALOG.REQUEST_EXPIRED.status).toBe(410);
  });
});

describe("envelope", () => {
  it("wraps data with meta and echoes the request id", async () => {
    const response = successResponse("req-1", { id: 1 }, { meta: { next_cursor: null } });
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(await response.json()).toEqual({ data: { id: 1 }, meta: { next_cursor: null } });
  });

  it("renders errors with code, message, request id and details, never cached", async () => {
    const response = errorResponse("req-2", new AppError("CAPACITY_UNAVAILABLE", { details: { modality_id: "m1" } }));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "CAPACITY_UNAVAILABLE", message: ERROR_CATALOG.CAPACITY_UNAVAILABLE.message, request_id: "req-2", details: { modality_id: "m1" } },
    });
  });

  it("sets Retry-After for RATE_LIMITED when the command reports it", () => {
    const response = errorResponse("req-3", new AppError("RATE_LIMITED", { details: { retry_after_seconds: 12.2 } }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("13");
  });
});

describe("toAppError", () => {
  it("hides unexpected errors behind INTERNAL_ERROR and logs only the error name", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = toAppError(new TypeError("duplicate key value (email)=(runner@example.test)"));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.status).toBe(500);
    const logged = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("runner@example.test");
    spy.mockRestore();
  });
});
