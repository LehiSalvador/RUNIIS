import { describe, expect, test } from "vitest";
import { searchEditionsQuerySchema } from "@/lib/server/domain/discovery/contracts";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  distancePresetKey,
  emptyVariant,
  filterChips,
  libraryHref,
  parseEventFilters,
  toQueryString,
  toSearchParams,
} from "@/lib/shared/event-filters";

describe("parseEventFilters (Master §55 URL state)", () => {
  test("round-trips a full filter state through the URL", () => {
    const query =
      "q=monterrey&type=TRAIL&type=ROAD_RACE&date_from=2026-10-01&date_to=2026-12-31&distance_min_m=5001&distance_max_m=10000&location=NL&price=PAID&price=FREE&registration_open=true";
    const filters = parseEventFilters(new URLSearchParams(query));
    expect(filters).toEqual({
      q: "monterrey",
      type: ["TRAIL", "ROAD_RACE"],
      date_from: "2026-10-01",
      date_to: "2026-12-31",
      distance_min_m: 5001,
      distance_max_m: 10000,
      location: "NL",
      price: ["PAID", "FREE"],
      registration_open: true,
    });
    expect(parseEventFilters(new URLSearchParams(toQueryString(filters)))).toEqual({ ...filters, type: ["ROAD_RACE", "TRAIL"], price: ["FREE", "PAID"] });
  });

  test("canonical ordering: equal states produce equal URLs", () => {
    const a = parseEventFilters({ type: ["TRAIL", "ROAD_RACE"], price: ["PAID", "FREE"] });
    const b = parseEventFilters({ type: ["ROAD_RACE", "TRAIL"], price: ["FREE", "PAID"] });
    expect(toQueryString(a)).toBe(toQueryString(b));
    expect(libraryHref(EMPTY_FILTERS)).toBe("/eventos");
  });

  test("hand-edited or stale values degrade to 'filter ignored', never to an error", () => {
    const filters = parseEventFilters({
      type: ["trail", "OK_KEY", "<script>"],
      date_from: "2026-02-30",
      date_to: "not-a-date",
      distance_min_m: "-5",
      distance_max_m: "99999999",
      price: ["GRATIS", "FREE"],
      registration_open: "yes",
      q: "   ",
    });
    expect(filters).toEqual({ ...EMPTY_FILTERS, type: ["OK_KEY"], price: ["FREE"] });
  });

  test("inverted ranges drop the upper bound instead of reaching the backend's VALIDATION_ERROR", () => {
    const filters = parseEventFilters({ date_from: "2026-12-01", date_to: "2026-11-01", distance_min_m: "10000", distance_max_m: "5000" });
    expect(filters.date_to).toBeNull();
    expect(filters.distance_max_m).toBeNull();
  });

  test("whatever the UI produces is accepted by the API query schema", () => {
    const filters = parseEventFilters(new URLSearchParams(`q=${"x".repeat(400)}&type=TRAIL&distance_max_m=5000&price=FREE&registration_open=true`));
    expect(filters.q).toHaveLength(160);
    const parsed = searchEditionsQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(toQueryString(filters, { limit: "12" }))));
    expect(parsed.success).toBe(true);
    expect(toSearchParams(filters)).toMatchObject({ type: ["TRAIL"], distance_max_m: 5000, registration_open: true });
  });
});

describe("filter state helpers", () => {
  test("active count counts dimensions, not values; search is not a filter", () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: "x" })).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, type: ["A", "B"], price: ["FREE"], date_to: "2026-01-01" })).toBe(3);
  });

  test("Master §56: the right empty variant", () => {
    expect(emptyVariant(EMPTY_FILTERS)).toBe("no_upcoming");
    expect(emptyVariant({ ...EMPTY_FILTERS, q: "zzz" })).toBe("search_no_match");
    expect(emptyVariant({ ...EMPTY_FILTERS, q: "zzz", registration_open: true })).toBe("filters_no_result");
  });

  test("distance presets and chips", () => {
    expect(distancePresetKey({ distance_min_m: null, distance_max_m: 5000 })).toBe("hasta-5k");
    expect(distancePresetKey({ distance_min_m: 1, distance_max_m: 2 })).toBeNull();
    const chips = filterChips({ ...EMPTY_FILTERS, type: ["TRAIL"], distance_min_m: 21098, date_from: "2026-10-01" }, (k) => `tipo ${k}`);
    expect(chips.map((c) => c.label)).toEqual(["tipo TRAIL", "Desde el 01/10/2026", "Más de medio maratón"]);
    expect(chips[0].remove.type).toEqual([]);
  });
});
