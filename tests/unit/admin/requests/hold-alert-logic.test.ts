import { describe, expect, test } from "vitest";
import { parseHoldAlert, queueHref, shareOfCapacity, TRIGGER_TEXT } from "@/components/admin/requests/hold-alert-logic";

const EDITION = "5a000000-0000-4000-8000-00000000000a";

describe("hold-concentration alert (OD-P2-01)", () => {
  test("reads the metadata of the task the server projects", () => {
    const alert = parseHoldAlert({
      pending_requests: 7,
      pending_places: 52,
      top_buyer_places: 18,
      capacity: 200,
      triggers: ["SINGLE_BUYER", "TOTAL_HOLD_SHARE"],
      top_requests: [
        { registration_request_id: "r1", public_reference: "R-AAAA-0001", places: 18, new_account: true },
        { registration_request_id: "r2", public_reference: "R-AAAA-0002", places: 9, new_account: false },
      ],
      modalities_over_threshold: [{ modality_id: "m1", name: "10K", capacity: 100, pending_places: 80 }],
      policy: { single_buyer_hold_places: 10 },
    });
    expect(alert).toMatchObject({ pendingPlaces: 52, pendingRequests: 7, topBuyerPlaces: 18, capacity: 200, triggers: ["SINGLE_BUYER", "TOTAL_HOLD_SHARE"], reopenedAfterWaive: false });
    expect(alert.topRequests).toEqual([
      { id: "r1", reference: "R-AAAA-0001", places: 18, newAccount: true },
      { id: "r2", reference: "R-AAAA-0002", places: 9, newAccount: false },
    ]);
    expect(alert.modalities).toEqual([{ id: "m1", name: "10K", capacity: 100, pendingPlaces: 80 }]);
  });

  test("older or partial tasks are read defensively: missing keys, unknown triggers and malformed rows are dropped, nothing throws", () => {
    expect(parseHoldAlert({})).toEqual({
      pendingPlaces: null,
      pendingRequests: null,
      topBuyerPlaces: null,
      capacity: null,
      triggers: [],
      topRequests: [],
      modalities: [],
      reopenedAfterWaive: false,
    });
    const odd = parseHoldAlert({
      pending_places: "many",
      triggers: ["SINGLE_BUYER", "FROM_THE_FUTURE", 3, null],
      top_requests: [null, "x", { public_reference: "R-1" }, { registration_request_id: "r", public_reference: "R-AAAA-0003", places: 4 }],
      modalities_over_threshold: [{ name: "10K" }, 4],
      reopened_after_waive: { waived_at: "2026-10-04T10:00:00Z" },
    });
    expect(odd.pendingPlaces).toBeNull();
    expect(odd.triggers).toEqual(["SINGLE_BUYER"]);
    expect(odd.topRequests).toEqual([{ id: "r", reference: "R-AAAA-0003", places: 4, newAccount: false }]);
    expect(odd.modalities).toEqual([]);
    expect(odd.reopenedAfterWaive).toBe(true);
  });

  test("every trigger the server can emit has staff-facing text", () => {
    for (const trigger of ["NEW_ACCOUNT_SHARE", "SINGLE_BUYER", "TOTAL_HOLD_SHARE", "MODALITY_HOLD_SHARE"] as const) expect(TRIGGER_TEXT[trigger].length).toBeGreaterThan(10);
  });

  test("share of capacity needs both numbers", () => {
    expect(shareOfCapacity({ pendingPlaces: 52, capacity: 200 })).toBe(26);
    expect(shareOfCapacity({ pendingPlaces: 1, capacity: 3 })).toBe(33.3);
    expect(shareOfCapacity({ pendingPlaces: null, capacity: 200 })).toBeNull();
    expect(shareOfCapacity({ pendingPlaces: 5, capacity: 0 })).toBeNull();
  });

  test("links go to the Edition's own queue filtered to the affected requests", () => {
    expect(queueHref(EDITION)).toBe(`/admin/eventos/${EDITION}/solicitudes`);
    expect(queueHref(EDITION, { status: "PENDING_CONFIRMATION" })).toBe(`/admin/eventos/${EDITION}/solicitudes?status=PENDING_CONFIRMATION`);
    expect(queueHref(EDITION, { status: "PENDING_CONFIRMATION", search: "R-AAAA-0001" })).toBe(`/admin/eventos/${EDITION}/solicitudes?status=PENDING_CONFIRMATION&search=R-AAAA-0001`);
  });
});
