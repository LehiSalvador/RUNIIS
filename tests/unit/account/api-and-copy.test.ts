import { describe, expect, test } from "vitest";
import { errorMessage, invalidFields, retryAfterSeconds, supportReference } from "@/lib/client/account-errors";
import { formatCalendarDate, formatMoney } from "@/lib/client/account-format";
import { toApiResult } from "@/lib/client/api";
import { presentRequest } from "@/lib/client/request-status";
import { REQUEST_STATUSES } from "@/lib/shared/registration";

describe("toApiResult (envelope -> union)", () => {
  test("success envelope", () => {
    expect(toApiResult(200, { data: { a: 1 }, meta: { next_cursor: null } })).toEqual({ ok: true, status: 200, data: { a: 1 }, meta: { next_cursor: null } });
  });
  test("error envelope keeps code, request id and details", () => {
    const result = toApiResult(429, { error: { code: "RATE_LIMITED", message: "x", request_id: "req-1", details: { retry_after_seconds: 42 } } });
    expect(result).toMatchObject({ ok: false, status: 429, code: "RATE_LIMITED", requestId: "req-1" });
    if (!result.ok) expect(retryAfterSeconds(result)).toBe(42);
  });
  test("anything else is a NETWORK_ERROR, never a crash", () => {
    expect(toApiResult(502, null)).toMatchObject({ ok: false, code: "NETWORK_ERROR" });
    expect(toApiResult(500, "<html>")).toMatchObject({ ok: false, code: "NETWORK_ERROR" });
  });
});

describe("error catalogue (ux-spec §5.1)", () => {
  test("maps codes to Spanish copy and falls back safely", () => {
    expect(errorMessage({ code: "IDENTITY_LOCKED" })).toMatch(/revisión/);
    expect(errorMessage({ code: "PASS_REPLACED" })).toMatch(/reemplazó/);
    expect(errorMessage({ code: "CAPACITY_UNAVAILABLE" })).toBe(errorMessage({ code: "INTERNAL_ERROR" }));
  });
  test("support reference only for unexpected failures", () => {
    expect(supportReference({ code: "INTERNAL_ERROR", requestId: "r1" })).toBe("r1");
    expect(supportReference({ code: "CONFLICT", requestId: "r1" })).toBeNull();
  });
  test("invalid fields from zod issues and DB {field, reason}", () => {
    const zod = invalidFields({ code: "VALIDATION_ERROR", details: { issues: [{ path: "phone_e164", code: "invalid" }, { path: "a.b" }] } });
    expect([...zod.keys()]).toEqual(["phone_e164", "a"]);
    const db = invalidFields({ code: "VALIDATION_ERROR", details: { field: "date_of_birth", reason: "UNDER_MIN_AGE" } });
    expect(db.get("date_of_birth")).toBe("UNDER_MIN_AGE");
    expect(invalidFields({ code: "CONFLICT", details: { field: "x" } }).size).toBe(0);
  });
});

describe("request presentation (ux-spec §5 rules 1, 3, 6)", () => {
  test("never says pagado, never promises refunds", () => {
    for (const status of REQUEST_STATUSES) {
      for (const mode of ["FREE", "EXTERNAL_WHATSAPP"] as const) {
        const { label, summary } = presentRequest(status, mode);
        expect(`${label} ${summary}`.toLowerCase()).not.toMatch(/pagad|reembols/);
      }
    }
  });
  test("pending is Apartado; expired is honest", () => {
    expect(presentRequest("PENDING_CONFIRMATION", "EXTERNAL_WHATSAPP").label).toBe("Apartado");
    expect(presentRequest("EXPIRED", "EXTERNAL_WHATSAPP").summary).toMatch(/se liberaron/);
  });
});

describe("formatting", () => {
  test("money from minor units; zero is Gratis", () => {
    expect(formatMoney(35000, "MXN")).toMatch(/350/);
    expect(formatMoney(0, "MXN")).toBe("Gratis");
  });
  test("calendar dates are not shifted by timezone", () => {
    expect(formatCalendarDate("2026-11-01")).toMatch(/^1 nov/);
    expect(formatCalendarDate(null)).toBe("Fecha por confirmar");
  });
});
