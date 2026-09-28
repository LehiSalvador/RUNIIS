import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { AppError } from "@/lib/server/http/errors";
import { parseGpxSafely } from "@/lib/server/domain/routes/gpx-parser";

// SEC-100/101 fixtures: every case here must return a fast VALIDATION_ERROR with bounded memory, or
// (for the valid fixtures) a clean, schema-conformant GeoJSON LineString + POI list.

const fixturesDir = fileURLToPath(new URL("../../fixtures/gpx/", import.meta.url));

function loadFixtureBase64(name: string): string {
  return readFileSync(`${fixturesDir}${name}`).toString("base64");
}

function expectValidationError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("VALIDATION_ERROR");
    return appError;
  }
  throw new Error("expected parseGpxSafely to throw");
}

describe("parseGpxSafely: valid fixtures", () => {
  test("a single track with lon/lat in the correct GeoJSON order", () => {
    const result = parseGpxSafely(loadFixtureBase64("valid_track.gpx"));
    expect(result.geometry.type).toBe("LineString");
    expect(result.geometry.coordinates).toEqual([
      [-100.3098, 25.67],
      [-100.305, 25.673],
      [-100.3, 25.676],
    ]);
    expect(result.pois).toEqual([]);
  });

  test("a <rte> is used when there is no <trk>", () => {
    const result = parseGpxSafely(loadFixtureBase64("valid_route.gpx"));
    expect(result.geometry.coordinates).toHaveLength(3);
  });

  test("waypoints become POIs, type inferred from name/sym, links are dropped (SEC-101)", () => {
    const result = parseGpxSafely(loadFixtureBase64("valid_waypoints.gpx"));
    expect(result.pois).toHaveLength(3);
    expect(result.pois[0]).toMatchObject({ poi_type: "START", name: "Salida", description: "Punto de salida oficial" });
    expect(result.pois[1]).toMatchObject({ poi_type: "HYDRATION" });
    expect(result.pois[2]).toMatchObject({ poi_type: "FINISH" });
    for (const poi of result.pois) {
      expect(poi).not.toHaveProperty("link");
      expect(poi).not.toHaveProperty("href");
    }
  });

  test("multiple <trkseg> within one <trk> are concatenated in order (multi-segment)", () => {
    const result = parseGpxSafely(loadFixtureBase64("multi_segment.gpx"));
    expect(result.geometry.coordinates).toEqual([
      [-100.3098, 25.67],
      [-100.3072, 25.6715],
      [-100.305, 25.673],
      [-100.3, 25.676],
    ]);
  });
});

describe("parseGpxSafely: SEC-100 hostile-input rejection (fast, bounded memory)", () => {
  test("billion laughs (nested entity expansion) is rejected before parsing", () => {
    const startedAt = Date.now();
    expectValidationError(() => parseGpxSafely(loadFixtureBase64("billion_laughs.gpx")));
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test("quadratic blowup (many entity references) is rejected before parsing", () => {
    expectValidationError(() => parseGpxSafely(loadFixtureBase64("quadratic_blowup.gpx")));
  });

  test("an external SYSTEM entity (XXE) is rejected before parsing", () => {
    const err = expectValidationError(() => parseGpxSafely(loadFixtureBase64("system_entity.gpx")));
    expect(err.details.reason).toBe("unsafe_xml_construct");
  });

  test("a file over 5MB (decoded) is rejected", () => {
    const oversized = Buffer.from(`<gpx><trk><trkseg>${"<trkpt lat=\"25.67\" lon=\"-100.30\" />".repeat(200_000)}</trkseg></trk></gpx>`);
    expect(oversized.byteLength).toBeGreaterThan(5_000_000);
    const err = expectValidationError(() => parseGpxSafely(oversized.toString("base64")));
    expect(err.details.reason).toBe("file_too_large");
  });

  test("more than 200k points is rejected (kept under the 5MB cap so the point-count check itself is exercised)", () => {
    const points = `<trkpt lat="1" lon="1"/>`.repeat(200_001);
    const xml = `<gpx><trk><trkseg>${points}</trkseg></trk></gpx>`;
    expect(Buffer.byteLength(xml)).toBeLessThan(5_000_000);
    const err = expectValidationError(() => parseGpxSafely(Buffer.from(xml).toString("base64")));
    expect(err.details.reason).toBe("too_many_points");
  });

  test("nesting deeper than the configured limit is rejected", () => {
    expectValidationError(() => parseGpxSafely(loadFixtureBase64("deep_nesting.gpx")));
  });

  test("NaN / out-of-range coordinates are rejected", () => {
    const err = expectValidationError(() => parseGpxSafely(loadFixtureBase64("invalid_coords.gpx")));
    expect(err.details.reason).toBe("invalid_coordinate");
  });

  // fast-xml-parser 5.11.1 itself refuses __proto__/constructor/toString-named tags outright
  // ("[SECURITY] Invalid name ... reserved JavaScript keyword"), so this fixture is rejected before
  // this module's own allowlisted-key reading (readKey/readText via Object.hasOwn, never a spread of
  // unknown parsed keys — the remaining SEC-101 defense-in-depth for non-reserved surprise keys, which
  // every other fixture above already exercises: <ele>, <sym>, <desc>, <creator> never leak into a POI).
  test("__proto__/constructor/toString-named XML elements are refused before this module ever sees them", () => {
    expectValidationError(() => parseGpxSafely(loadFixtureBase64("proto_keys.gpx")));
  });

  test("a non-GPX XML document is rejected", () => {
    expectValidationError(() => parseGpxSafely(Buffer.from("<not-gpx><a>1</a></not-gpx>").toString("base64")));
  });

  test("malformed XML is rejected", () => {
    expectValidationError(() => parseGpxSafely(Buffer.from("<gpx><trk>").toString("base64")));
  });

  test("waypoints alone (no track/route) are rejected: they never form a line", () => {
    const xml = '<gpx><wpt lat="25.67" lon="-100.30"><name>Only a point</name></wpt></gpx>';
    const err = expectValidationError(() => parseGpxSafely(Buffer.from(xml).toString("base64")));
    expect(err.details.reason).toBe("no_track_or_route_found");
  });

  test("invalid base64 is rejected", () => {
    expectValidationError(() => parseGpxSafely("not valid base64!!!"));
  });
});

describe("parseGpxSafely: GPX never touches official_distance (Master §49)", () => {
  test("the parser result carries no distance field at all", () => {
    const result = parseGpxSafely(loadFixtureBase64("valid_track.gpx"));
    expect(result).not.toHaveProperty("official_distance_m");
    expect(result).not.toHaveProperty("computed_distance_m");
  });
});
