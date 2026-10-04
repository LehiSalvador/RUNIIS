import { describe, expect, test } from "vitest";
import type { BulkCancelResult } from "@/lib/shared/registration";
import {
  BULK_CANCEL_MAX_REQUESTS,
  blockingLines,
  bulkEligibleIds,
  bulkOutcomeText,
  bulkSummary,
  canBulkCancel,
  canCancelRequest,
  confirmMode,
  describeRequestFailure,
  effectiveStatusAt,
  failedIds,
  formatCountdown,
  holdState,
  isTransientFailure,
  placesOf,
  priceChange,
  pruneSelection,
  remainingMs,
  selectionSummary,
  serverNowMs,
  type QueueRequest,
} from "@/components/admin/requests/request-logic";

const NOW = Date.parse("2026-10-04T18:00:00Z");

function request(overrides: Partial<QueueRequest> & { places?: number } = {}): QueueRequest {
  const places = overrides.places ?? 1;
  return {
    registration_request_id: overrides.registration_request_id ?? "11111111-1111-4111-8111-111111111111",
    public_reference: "R-AAAA-BBBB",
    edition: { edition_id: "e", name: "E", slug: "e" },
    status: "PENDING_CONFIRMATION",
    effective_status: "PENDING_CONFIRMATION",
    registration_mode: "EXTERNAL_WHATSAPP",
    currency: "MXN",
    total_snapshot_minor: 35000,
    created_at: "2026-10-04T17:00:00Z",
    expires_at: "2026-10-04T19:00:00Z",
    confirmed_at: null,
    canceled_at: null,
    revalidated_from_expired: false,
    whatsapp_phone_e164: "+528110000099",
    server_time: "2026-10-04T18:00:00Z",
    participants: Array.from({ length: places }, (_, index) => ({
      request_participant_id: `p${index}`,
      participant_kind: "GUEST" as const,
      public_profile_id: null,
      guest_participant_id: `g${index}`,
      is_buyer: false,
      display_name: `Persona ${index + 1}`,
      modality: { modality_id: "m", name: "10K" },
      category: null,
      price_snapshot_minor: 35000,
      legal_acceptance_status: "ACCEPTED" as const,
      kit_selection: null,
      registration: null,
    })),
    whatsapp_url: null,
    ...overrides,
  } as QueueRequest;
}

describe("effective status and the server's clock", () => {
  test("a request past its expiry reads as expired even though the stored status is still pending", () => {
    const row = request({ expires_at: "2026-10-04T17:59:00Z", effective_status: "PENDING_CONFIRMATION" });
    expect(row.status).toBe("PENDING_CONFIRMATION");
    expect(effectiveStatusAt(row, NOW)).toBe("EXPIRED");
  });

  test("the server's derivation wins and only moves forward when the expiry passes while the page is open", () => {
    const live = request({ expires_at: "2026-10-04T18:00:30Z" });
    expect(effectiveStatusAt(live, NOW)).toBe("PENDING_CONFIRMATION");
    expect(effectiveStatusAt(live, NOW + 31_000)).toBe("EXPIRED");
    // a confirmed or canceled request is never turned into anything else by the clock
    expect(effectiveStatusAt(request({ status: "CONFIRMED", effective_status: "CONFIRMED", expires_at: "2026-10-01T00:00:00Z" }), NOW)).toBe("CONFIRMED");
    expect(effectiveStatusAt(request({ status: "CANCELED_BY_STAFF", effective_status: "CANCELED_BY_STAFF" }), NOW + 10 ** 9)).toBe("CANCELED_BY_STAFF");
  });

  test("now is the server's time plus the time since the page rendered, never the operator's clock", () => {
    const row = request({ server_time: "2026-10-04T18:00:00Z" });
    expect(serverNowMs(row, 0)).toBe(NOW);
    expect(serverNowMs(row, 5_000)).toBe(NOW + 5_000);
    expect(serverNowMs(row, -50)).toBe(NOW);
    expect(remainingMs(row, NOW)).toBe(3_600_000);
    expect(remainingMs(request({ expires_at: null }), NOW)).toBeNull();
  });

  test("countdown text", () => {
    expect(formatCountdown(2 * 3_600_000 + 5 * 60_000 + 59_000)).toBe("2 h 05 min");
    expect(formatCountdown(12 * 60_000 + 5_000)).toBe("12 min 05 s");
    expect(formatCountdown(45_000)).toBe("45 s");
    expect(formatCountdown(0)).toBe("Vence ya");
    expect(formatCountdown(-10)).toBe("Vence ya");
  });
});

describe("hold, commands and bulk eligibility", () => {
  test("the hold is stated per state and a confirmed or canceled request holds nothing", () => {
    expect(holdState("PENDING_CONFIRMATION", request({ places: 2 })).held).toBe(true);
    expect(holdState("PENDING_CONFIRMATION", request({ places: 2 })).label).toContain("2 lugares apartados");
    expect(holdState("EXPIRED", request()).held).toBe(false);
    expect(holdState("CANCELED_BY_STAFF", request()).label).toBe("Cupo liberado");
    expect(placesOf(request({ places: 3 }))).toBe(3);
  });

  test("confirm before expiry, explicit revalidation after, nothing once it is closed", () => {
    expect(confirmMode(request(), "PENDING_CONFIRMATION")).toBe("confirm");
    expect(confirmMode(request(), "EXPIRED")).toBe("revalidate");
    expect(confirmMode(request({ status: "EXPIRED", effective_status: "EXPIRED" }), "EXPIRED")).toBe("revalidate");
    expect(confirmMode(request({ status: "CONFIRMED" }), "CONFIRMED")).toBeNull();
    expect(confirmMode(request({ status: "CANCELED_BY_BUYER" }), "CANCELED_BY_BUYER")).toBeNull();
    expect(confirmMode(request({ status: "CANCELED_BY_STAFF" }), "CANCELED_BY_STAFF")).toBeNull();
  });

  test("staff cancel applies to pending and expired requests, never to a confirmed one", () => {
    expect(canCancelRequest({ status: "PENDING_CONFIRMATION" })).toBe(true);
    expect(canCancelRequest({ status: "EXPIRED" })).toBe(true);
    expect(canCancelRequest({ status: "CONFIRMED" })).toBe(false);
    expect(canCancelRequest({ status: "CANCELED_BY_BUYER" })).toBe(false);
  });

  test("bulk cancel is offered only for requests still PENDING in the database (a confirmed registration is never selectable)", () => {
    expect(canBulkCancel({ status: "PENDING_CONFIRMATION" })).toBe(true);
    for (const status of ["CONFIRMED", "EXPIRED", "CANCELED_BY_BUYER", "CANCELED_BY_STAFF"] as const) expect(canBulkCancel({ status }), status).toBe(false);
    const rows = [
      request({ registration_request_id: "a" }),
      request({ registration_request_id: "b", status: "CONFIRMED" }),
      request({ registration_request_id: "c", status: "EXPIRED" }),
      request({ registration_request_id: "d" }),
    ];
    expect(bulkEligibleIds(rows)).toEqual(["a", "d"]);
  });

  test("a selection never outlives its row or holds a row that cannot be cancelled in bulk", () => {
    const rows = [request({ registration_request_id: "a", places: 2 }), request({ registration_request_id: "b", status: "CONFIRMED" }), request({ registration_request_id: "d", places: 3 })];
    expect([...pruneSelection(new Set(["a", "b", "gone", "d"]), rows)]).toEqual(["a", "d"]);
    expect(selectionSummary(new Set(["a", "d"]), rows)).toEqual({ requests: 2, places: 5 });
    expect(selectionSummary(new Set(), rows)).toEqual({ requests: 0, places: 0 });
    expect(BULK_CANCEL_MAX_REQUESTS).toBe(100);
  });
});

describe("bulk results (partial success)", () => {
  const result: BulkCancelResult = {
    edition_id: "e",
    correlation_id: "c",
    requested_count: 5,
    canceled_count: 2,
    already_canceled_count: 1,
    rejected_count: 1,
    failed_count: 1,
    results: [
      { registration_request_id: "a", outcome: "CANCELED", status: "CANCELED_BY_STAFF" },
      { registration_request_id: "b", outcome: "CANCELED", status: "CANCELED_BY_STAFF" },
      { registration_request_id: "c", outcome: "ALREADY_CANCELED", status: "CANCELED_BY_STAFF" },
      { registration_request_id: "d", outcome: "NOT_CANCELABLE", status: "CONFIRMED" },
      { registration_request_id: "e", outcome: "FAILED", code: "INTERNAL_ERROR" },
    ],
  };

  test("the summary names every kind of outcome with counts only", () => {
    expect(bulkSummary(result)).toBe("2 canceladas, 1 ya estaba cancelada, 1 sin cambios, 1 con error de 5.");
    expect(bulkSummary({ ...result, canceled_count: 0, already_canceled_count: 0, rejected_count: 0, failed_count: 0 })).toBe("No se canceló ninguna solicitud.");
  });

  test("each row says what happened to that request, and a not-cancelable one names its current status", () => {
    expect(bulkOutcomeText(result.results[0])).toBe("Cancelada");
    expect(bulkOutcomeText(result.results[3])).toBe("Ya estaba: confirmada");
    expect(bulkOutcomeText(result.results[4])).toContain("Reintenta solo esta solicitud");
    expect(bulkOutcomeText({ registration_request_id: "x", outcome: "NOT_FOUND" })).toBe("No encontrada");
  });

  test("only the failed ids stay selected for a retry", () => {
    expect(failedIds(result)).toEqual(["e"]);
  });
});

describe("refusals", () => {
  const people = [{ display_name: "Ana" }, { display_name: null }, { display_name: "Luis" }];

  test("a missing acceptance names the participants who still owe it", () => {
    const failure = { code: "LEGAL_ACCEPTANCE_REQUIRED", details: { participant_index: 1, issues: [{ participant_index: 1, code: "LEGAL_ACCEPTANCE_REQUIRED" }, { participant_index: 2, code: "LEGAL_ACCEPTANCE_REQUIRED" }] } };
    expect(blockingLines(failure, people)).toEqual(["Participante 2: falta aceptar los documentos legales.", "Luis: falta aceptar los documentos legales."]);
    expect(describeRequestFailure(failure, people)).toMatchObject({ title: "Falta la aceptación de términos", refreshes: false });
    expect(blockingLines({ code: "X", details: {} }, people)).toEqual([]);
    expect(blockingLines({ code: "X", details: { issues: [{ participant_index: 9, code: "UNKNOWN" }] } }, people)).toEqual(["Un participante: no cumple un requisito de la confirmación."]);
  });

  test("a changed price carries both totals so staff can coordinate before acknowledging", () => {
    const failure = { code: "PRICE_CHANGED", details: { snapshot_total_minor: 30000, current_total_minor: 35000, currency: "MXN" } };
    expect(priceChange(failure)).toEqual({ snapshotMinor: 30000, currentMinor: 35000, currency: "MXN" });
    expect(priceChange({ code: "PRICE_CHANGED", details: {} })).toBeNull();
    expect(priceChange({ code: "CONFLICT", details: failure.details })).toBeNull();
    expect(describeRequestFailure(failure)?.message).toContain("Coordina con el comprador");
  });

  test("capacity, expiry and closed-request refusals have their own words and the stale ones reload", () => {
    expect(describeRequestFailure({ code: "CAPACITY_UNAVAILABLE" })?.message).toContain("Ya no hay cupo");
    expect(describeRequestFailure({ code: "GLOBAL_CAPACITY_UNAVAILABLE" })?.title).toBe("Sin cupo");
    expect(describeRequestFailure({ code: "REQUEST_EXPIRED" })).toMatchObject({ refreshes: true });
    for (const reason of ["REQUEST_CANCELED", "REQUEST_NOT_CANCELABLE", "REQUEST_NOT_EXPIRED", "CLAIMS_RELEASED"]) {
      expect(describeRequestFailure({ code: "CONFLICT", details: { reason } }), reason).toMatchObject({ refreshes: true });
    }
    // anything else is left to the shared error model
    expect(describeRequestFailure({ code: "INTERNAL_ERROR" })).toBeNull();
    expect(describeRequestFailure({ code: "CONFLICT", details: { reason: "something_else" } })).toBeNull();
    expect(describeRequestFailure({ code: "RATE_LIMITED" })).toBeNull();
  });

  test("a lost connection, a rate limit or lock contention retries the same intent; a refusal ends it", () => {
    for (const code of ["NETWORK_ERROR", "RATE_LIMITED", "DEPENDENCY_UNAVAILABLE", "INTERNAL_ERROR"]) expect(isTransientFailure({ code }), code).toBe(true);
    expect(isTransientFailure({ code: "CONFLICT", details: { retryable: true } })).toBe(true);
    for (const code of ["VALIDATION_ERROR", "FORBIDDEN", "LEGAL_ACCEPTANCE_REQUIRED", "PRICE_CHANGED", "IDEMPOTENCY_CONFLICT"]) expect(isTransientFailure({ code }), code).toBe(false);
    expect(isTransientFailure({ code: "CONFLICT", details: { reason: "invalid_transition" } })).toBe(false);
  });
});
