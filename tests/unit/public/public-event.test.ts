import { describe, expect, test } from "vitest";
import {
  dateTileParts,
  describeEligibility,
  formatDistance,
  formatLocalTime,
  formatLongDate,
  formatMoney,
  isPastSportDate,
  publicStatus,
  scheduleDisplay,
  summarizeDistance,
  summarizePrice,
  whatsAppContactUrl,
  type ModalitySummary,
} from "@/lib/shared/public-event";

const summary = (over: Partial<ModalitySummary>): ModalitySummary => ({
  count: 1,
  min_distance_m: 5000,
  max_distance_m: 5000,
  distance_varies: false,
  min_amount_minor: 0,
  max_amount_minor: 0,
  currency: "MXN",
  price_varies: false,
  price_pending: false,
  ...over,
});

describe("Master §57 card summaries never show one misleading value", () => {
  test("single modality shows its distance", () => {
    expect(summarizeDistance(summary({}))).toBe("5 km");
  });
  test("different distances show a range and the modality count", () => {
    expect(summarizeDistance(summary({ count: 2, min_distance_m: 10000, max_distance_m: 21097, distance_varies: true }))).toBe("2 modalidades · 10–21.1 km");
  });
  test("no modalities / unknown distance are stated, not invented", () => {
    expect(summarizeDistance(summary({ count: 0, min_distance_m: null, max_distance_m: null }))).toBe("Modalidades por anunciar");
    expect(summarizeDistance(summary({ min_distance_m: null, max_distance_m: null }))).toBe("Distancia por confirmar");
  });
  test("prices: free, range, pending", () => {
    expect(summarizePrice(summary({}))).toBe("Gratis");
    expect(summarizePrice(summary({ count: 2, min_amount_minor: 35000, max_amount_minor: 60000, price_varies: true }))).toBe("$350 – $600");
    expect(summarizePrice(summary({ min_amount_minor: null, max_amount_minor: null }))).toBe("Precio por confirmar");
    expect(summarizePrice(summary({ count: 2, min_amount_minor: 35000, max_amount_minor: 35000, price_pending: true }))).toBe("$350 · otras por confirmar");
  });
});

describe("publicStatus follows the mapCta precedence (Master §58)", () => {
  test("execution outcomes win over registration and availability", () => {
    expect(publicStatus("OPEN", "CANCELED", "AVAILABLE").state).toBe("CANCELED");
    expect(publicStatus("PAUSED", "POSTPONED", null).state).toBe("POSTPONED");
    expect(publicStatus("CLOSED", "FINISHED", null).state).toBe("FINISHED");
  });
  test("a hold-only block is never 'Agotado' (Master §36, AC-J7-1)", () => {
    expect(publicStatus("OPEN", "SCHEDULED", "TEMPORARILY_UNAVAILABLE").state).toBe("TEMPORARILY_UNAVAILABLE");
    expect(publicStatus("OPEN", "SCHEDULED", "SOLD_OUT").state).toBe("SOLD_OUT");
  });
  test("registration states", () => {
    expect(publicStatus("OPEN", "SCHEDULED", "AVAILABLE")).toEqual({ state: "AVAILABLE", label: "Inscripciones abiertas" });
    expect(publicStatus("OPEN", "SCHEDULED", "LOW").state).toBe("LOW");
    expect(publicStatus("NOT_OPEN", "SCHEDULED", null).state).toBe("NOT_OPEN");
    expect(publicStatus("CLOSED", "SCHEDULED", null).state).toBe("CLOSED");
    expect(publicStatus("PAUSED", "SCHEDULED", null).state).toBe("TEMPORARILY_UNAVAILABLE");
  });
});

describe("schedule display (Master §29: a pending time is never rendered as 00:00)", () => {
  test("variants", () => {
    expect(scheduleDisplay(null)).toEqual({ kind: "unknown" });
    expect(scheduleDisplay({ schedule_state: "POSTPONED_NO_NEW_DATE", local_date: null, local_start_time: null })).toEqual({ kind: "postponed" });
    expect(scheduleDisplay({ schedule_state: "DATE_CONFIRMED_TIME_PENDING", local_date: "2026-11-27", local_start_time: null })).toEqual({ kind: "time_pending", date: "2026-11-27" });
    expect(scheduleDisplay({ schedule_state: "DATE_TIME_CONFIRMED", local_date: "2026-11-27", local_start_time: "07:00:00" })).toEqual({ kind: "confirmed", date: "2026-11-27", time: "07:00:00" });
  });
});

describe("formatting", () => {
  test("dates keep the published calendar day regardless of timezone", () => {
    expect(formatLongDate("2026-11-27")).toMatch(/27 de noviembre de 2026/);
    expect(dateTileParts("2026-12-01")).toMatchObject({ day: "01", year: "2026" });
    expect(dateTileParts("nope")).toBeNull();
  });
  test("time, distance, money", () => {
    expect(formatLocalTime("07:00:00")).toMatch(/^7:00/);
    expect(formatDistance(800)).toBe("800 m");
    expect(formatDistance(42195)).toBe("42.2 km");
    expect(formatMoney(0, "MXN")).toBe("Gratis");
    expect(formatMoney(35050, "MXN")).toBe("$350.50");
  });
  test("past bucket mirrors search_editions (sport_date < today)", () => {
    expect(isPastSportDate("2026-09-27", "2026-09-28")).toBe(true);
    expect(isPastSportDate("2026-09-28", "2026-09-28")).toBe(false);
    expect(isPastSportDate(null, "2026-09-28")).toBe(false);
  });
  test("eligibility text", () => {
    expect(describeEligibility({ min_age: 40 })).toBe("40 años o más");
    expect(describeEligibility({ min_age: 18, max_age: 39, sex_codes: ["F"] })).toBe("18 a 39 años · Mujeres");
    expect(describeEligibility({})).toBeNull();
  });
  test("WhatsApp contact link only for a valid E.164 number, without participant data", () => {
    expect(whatsAppContactUrl("+528110000001")).toBe("https://wa.me/528110000001");
    expect(whatsAppContactUrl("8110000001")).toBeNull();
    expect(whatsAppContactUrl(null)).toBeNull();
  });
});
