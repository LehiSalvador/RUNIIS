import { describe, expect, test } from "vitest";
import { editionSlugParamSchema, searchEditionsQuerySchema } from "@/lib/server/domain/discovery/contracts";

// Contract-level tests for the discovery domain's zod boundary (SEC-005/120): the query schema is
// what actually parses `defineRoute`'s grouped searchParams object (repeated keys become an array,
// a single key stays a string — lib/server/http/handler.ts's `searchParamsToObject`), so every case
// here mirrors what a real GET /api/v1/events request produces.

describe("searchEditionsQuerySchema: repeated query params (type, price)", () => {
  test("a single `type` value arrives as a string and is normalized to a one-element array", () => {
    const parsed = searchEditionsQuerySchema.parse({ type: "ROAD_RACE" });
    expect(parsed.type).toEqual(["ROAD_RACE"]);
  });

  test("repeated `type` values arrive as an array and pass through", () => {
    const parsed = searchEditionsQuerySchema.parse({ type: ["ROAD_RACE", "TRAIL_RACE"] });
    expect(parsed.type).toEqual(["ROAD_RACE", "TRAIL_RACE"]);
  });

  test("rejects a type key that does not match the event_type.key charset", () => {
    expect(() => searchEditionsQuerySchema.parse({ type: "road-race" })).toThrow();
    expect(() => searchEditionsQuerySchema.parse({ type: "1ROAD" })).toThrow();
  });

  test("price only accepts FREE/PAID (case-sensitive) and normalizes to an array", () => {
    expect(searchEditionsQuerySchema.parse({ price: "FREE" }).price).toEqual(["FREE"]);
    expect(searchEditionsQuerySchema.parse({ price: ["FREE", "PAID"] }).price).toEqual(["FREE", "PAID"]);
    expect(() => searchEditionsQuerySchema.parse({ price: "free" })).toThrow();
    expect(() => searchEditionsQuerySchema.parse({ price: "CHEAP" })).toThrow();
  });

  test("undefined stays undefined (no filter) rather than becoming an empty array", () => {
    expect(searchEditionsQuerySchema.parse({}).type).toBeUndefined();
    expect(searchEditionsQuerySchema.parse({}).price).toBeUndefined();
  });
});

describe("searchEditionsQuerySchema: registration_open boolean coercion", () => {
  test("the string \"true\"/\"false\" from the URL become real booleans", () => {
    expect(searchEditionsQuerySchema.parse({ registration_open: "true" }).registration_open).toBe(true);
    expect(searchEditionsQuerySchema.parse({ registration_open: "false" }).registration_open).toBe(false);
  });

  test("rejects any value other than the literal strings true/false", () => {
    expect(() => searchEditionsQuerySchema.parse({ registration_open: "1" })).toThrow();
    expect(() => searchEditionsQuerySchema.parse({ registration_open: "yes" })).toThrow();
  });
});

describe("searchEditionsQuerySchema: numeric and date bounds", () => {
  test("distance_min_m/max_m coerce from query strings and reject out-of-range or negative values", () => {
    expect(searchEditionsQuerySchema.parse({ distance_min_m: "5000" }).distance_min_m).toBe(5000);
    expect(() => searchEditionsQuerySchema.parse({ distance_min_m: "-1" })).toThrow();
    expect(() => searchEditionsQuerySchema.parse({ distance_min_m: "not-a-number" })).toThrow();
  });

  test("date_from/date_to require YYYY-MM-DD", () => {
    expect(searchEditionsQuerySchema.parse({ date_from: "2026-12-01" }).date_from).toBe("2026-12-01");
    expect(() => searchEditionsQuerySchema.parse({ date_from: "12/01/2026" })).toThrow();
    expect(() => searchEditionsQuerySchema.parse({ date_from: "2026-12-01T00:00:00Z" })).toThrow();
  });

  test("limit is clamped to 1..50 and cursor is a plain trimmed string", () => {
    expect(() => searchEditionsQuerySchema.parse({ limit: "0" })).toThrow();
    expect(() => searchEditionsQuerySchema.parse({ limit: "51" })).toThrow();
    expect(searchEditionsQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(searchEditionsQuerySchema.parse({ cursor: "abc123" }).cursor).toBe("abc123");
  });

  test("rejects an unknown query key (SEC-016/120)", () => {
    expect(() => searchEditionsQuerySchema.parse({ q: "carrera", sort: "price" })).toThrow();
  });
});

describe("editionSlugParamSchema", () => {
  test("accepts a well-formed slug", () => {
    expect(editionSlugParamSchema.parse({ edition: "carrera-demo-2026" }).edition).toBe("carrera-demo-2026");
  });

  test("rejects path-hostile or malformed input", () => {
    expect(() => editionSlugParamSchema.parse({ edition: "../../etc/passwd" })).toThrow();
    expect(() => editionSlugParamSchema.parse({ edition: "Carrera-Con-Mayusculas" })).toThrow();
    expect(() => editionSlugParamSchema.parse({ edition: "" })).toThrow();
    expect(() => editionSlugParamSchema.parse({ edition: "-empieza-con-guion" })).toThrow();
  });
});
