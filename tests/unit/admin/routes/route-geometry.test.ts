import { describe, expect, test } from "vitest";
import {
  GPX_MAX_FILE_BYTES,
  REVISION_BODY_LIMIT_BYTES,
  bodyBytes,
  boundsOf,
  bytesToBase64,
  checkGpxFile,
  cumulativeM,
  defaultRevisionId,
  describeIssue,
  draftProblems,
  geometryInput,
  gpxFailureReason,
  haversineM,
  hasProblems,
  midpoint,
  nearestSegment,
  nearestVertex,
  orderPois,
  parseCoordinate,
  parseValidation,
  pathLengthM,
  poiFromServer,
  poiToInput,
  roundCoord,
  sameCoords,
  simplifyRoute,
  simplifyUntilFits,
  type LonLat,
  type PoiDraft,
} from "@/components/admin/routes/route-geometry";

// A gentle zig-zag of `n` points a little over 10 m apart near Monterrey.
function track(n: number): LonLat[] {
  return Array.from({ length: n }, (_, i) => [-100.3161 + i * 0.0001, 25.6866 + (i % 2) * 0.00002] as LonLat);
}

describe("distances", () => {
  test("haversine matches a known short baseline and is symmetric", () => {
    // 0.01 degrees of latitude is ~1 112 m anywhere.
    const d = haversineM([-100, 25], [-100, 25.01]);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1125);
    expect(haversineM([-100, 25.01], [-100, 25])).toBeCloseTo(d, 6);
    expect(haversineM([1, 1], [1, 1])).toBe(0);
  });

  test("path length and cumulative distance agree and start at zero", () => {
    const points = track(50);
    const cumulative = cumulativeM(points);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[cumulative.length - 1]).toBeCloseTo(pathLengthM(points), 6);
    expect(pathLengthM([])).toBe(0);
    expect(pathLengthM([[0, 0]])).toBe(0);
  });
});

describe("coordinates", () => {
  test("parseCoordinate accepts decimals with a comma and refuses ranges and text", () => {
    expect(parseCoordinate("25,6866", "lat")).toBe(25.6866);
    expect(parseCoordinate(" -100.3161 ", "lon")).toBe(-100.3161);
    expect(parseCoordinate("90", "lat")).toBe(90);
    expect(parseCoordinate("90.0001", "lat")).toBeNull();
    expect(parseCoordinate("-181", "lon")).toBeNull();
    expect(parseCoordinate("", "lat")).toBeNull();
    expect(parseCoordinate("abc", "lon")).toBeNull();
    expect(parseCoordinate("1e3", "lon")).toBeNull();
  });

  test("roundCoord keeps six decimals and sameCoords compares by value", () => {
    expect(roundCoord([-100.31612345678, 25.68660000049])).toEqual([-100.316123, 25.6866]);
    expect(sameCoords([[1, 2]], [[1, 2]])).toBe(true);
    expect(sameCoords([[1, 2]], [[1, 3]])).toBe(false);
    expect(sameCoords([[1, 2]], [[1, 2], [3, 4]])).toBe(false);
  });

  test("bounds, nearest vertex and midpoint", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([[-100, 25], [-99, 26], [-101, 24]])).toEqual({ west: -101, south: 24, east: -99, north: 26 });
    expect(nearestVertex([[0, 0], [1, 1], [2, 2]], [1.1, 1.1])?.index).toBe(1);
    expect(nearestVertex([], [0, 0])).toBeNull();
    expect(midpoint([0, 0], [2, 4])).toEqual([1, 2]);
  });
});

describe("insert vertex finds the closest segment", () => {
  const line: LonLat[] = [[-100.0, 25.0], [-100.0, 25.01], [-99.99, 25.01]];
  test("a point beside the second leg belongs to the second segment", () => {
    expect(nearestSegment(line, [-99.995, 25.0102])?.index).toBe(1);
  });
  test("a point beside the first leg belongs to the first segment", () => {
    expect(nearestSegment(line, [-100.0002, 25.005])?.index).toBe(0);
  });
  test("needs two vertices", () => {
    expect(nearestSegment([[0, 0]], [0, 0])).toBeNull();
  });
});

describe("simplification (explicit operator action only)", () => {
  test("keeps the ends, drops collinear points and never moves a kept point", () => {
    const straight: LonLat[] = Array.from({ length: 200 }, (_, i) => [-100 + i * 0.0001, 25] as LonLat);
    const simple = simplifyRoute(straight, 1);
    expect(simple).toEqual([straight[0], straight[199]]);
    const bent: LonLat[] = [[-100, 25], [-99.999, 25], [-99.999, 25.001]];
    expect(simplifyRoute(bent, 1)).toEqual(bent);
  });

  test("simplifyUntilFits finds the smallest tolerance that fits and reports null when nothing does", () => {
    const wiggly = track(4000);
    const fits = (candidate: LonLat[]) => bodyBytes({ geometry: geometryInput(candidate) }) <= REVISION_BODY_LIMIT_BYTES;
    expect(fits(wiggly)).toBe(false);
    const result = simplifyUntilFits(wiggly, fits);
    expect(result).not.toBeNull();
    expect(result!.coords.length).toBeLessThan(wiggly.length);
    expect(result!.coords[0]).toEqual(roundCoord(wiggly[0]));
    expect(fits(result!.coords)).toBe(true);
    expect(simplifyUntilFits(wiggly, () => false)).toBeNull();
  });
});

describe("request size (the revision endpoints keep the default 64 KiB body limit)", () => {
  test("a few thousand points already exceed it and a short manual route does not", () => {
    expect(bodyBytes({ geometry: geometryInput(track(4000)) })).toBeGreaterThan(REVISION_BODY_LIMIT_BYTES);
    expect(bodyBytes({ geometry: geometryInput(track(100)) })).toBeLessThan(REVISION_BODY_LIMIT_BYTES);
  });
  test("bodyBytes counts bytes, not characters", () => {
    expect(bodyBytes({ a: "ñ" })).toBe(JSON.stringify({ a: "ñ" }).length + 1);
  });
});

describe("POIs", () => {
  const server = { route_poi_id: "p1", poi_type: "HYDRATION", name: "Agua", longitude: -100.3, latitude: 25.6, sort_order: 1, metadata: { description: "Cada 5 km" } };
  test("server POIs map to drafts (description lives in metadata) and back to API input", () => {
    const draft = poiFromServer(server);
    expect(draft).toMatchObject({ key: "p1", poi_type: "HYDRATION", name: "Agua", description: "Cada 5 km" });
    expect(poiToInput(draft)).toEqual({ poi_type: "HYDRATION", name: "Agua", description: "Cada 5 km", longitude: -100.3, latitude: 25.6 });
    expect(poiToInput({ ...draft, description: "  " })).not.toHaveProperty("description");
    expect(poiFromServer({ ...server, poi_type: "FUTURE_TYPE", metadata: {} }).poi_type).toBe("OTHER");
  });

  test("start first, finish last, the rest keep their order", () => {
    const poi = (key: string, poi_type: PoiDraft["poi_type"]): PoiDraft => ({ key, poi_type, name: key, description: "", longitude: 0, latitude: 0 });
    expect(orderPois([poi("a", "OTHER"), poi("f", "FINISH"), poi("b", "MEDICAL"), poi("s", "START")]).map((p) => p.key)).toEqual(["s", "a", "b", "f"]);
  });

  test("draftProblems asks for two points, names and sane lengths", () => {
    const named: PoiDraft = { key: "k", poi_type: "OTHER", name: "Ok", description: "", longitude: 0, latitude: 0 };
    expect(hasProblems(draftProblems(track(2), [named]))).toBe(false);
    expect(draftProblems(track(1), []).geometry).toMatch(/al menos 2 puntos/);
    expect(draftProblems(track(2), [{ ...named, name: "  " }]).pois.k).toMatch(/nombre/);
    expect(draftProblems(track(2), [{ ...named, name: "x".repeat(121) }]).pois.k).toMatch(/120/);
  });
});

describe("server validation result", () => {
  test("{} (never validated, or edited since) is not a result", () => {
    expect(parseValidation({})).toBeNull();
    expect(parseValidation(null)).toBeNull();
    expect(parseValidation({ valid: true, errors: [], warnings: "x" })).toBeNull();
  });

  test("parses errors and warnings and ignores items without a code", () => {
    const parsed = parseValidation({
      valid: false,
      errors: [{ code: "GEOMETRY_MISSING" }, { nope: 1 }],
      warnings: [{ code: "START_FINISH_MISSING", detail: { has_start: true, has_finish: false } }],
      validated_at: "2026-10-03T10:00:00Z",
    });
    expect(parsed?.valid).toBe(false);
    expect(parsed?.errors).toEqual([{ code: "GEOMETRY_MISSING", detail: undefined }]);
    expect(parsed?.warnings[0].detail).toEqual({ has_start: true, has_finish: false });
  });

  test("every documented code has a sentence and an unknown code never leaks raw text", () => {
    const codes = [
      "GEOMETRY_MISSING",
      "LINESTRING_DEGENERATE",
      "INVALID_GEOMETRY",
      "COORDINATES_OUT_OF_RANGE",
      "TOO_MANY_POINTS",
      "IMPROBABLE_JUMP",
      "SELF_INTERSECTION",
      "START_FINISH_MISSING",
      "POI_FAR_FROM_ROUTE",
      "DISTANCE_MISMATCH",
    ];
    for (const code of codes) expect(describeIssue({ code }), code).not.toMatch(/observación/);
    expect(describeIssue({ code: "START_FINISH_MISSING", detail: { has_start: true, has_finish: false } })).toBe("Falta definir la meta.");
    expect(describeIssue({ code: "START_FINISH_MISSING", detail: { has_start: false, has_finish: false } })).toBe("Falta definir la salida y la meta.");
    expect(describeIssue({ code: "DISTANCE_MISMATCH", detail: { modality_id: "m1", computed_distance_m: 12000, official_distance_m: 10000 } }, () => "10K")).toContain("oficial de 10K");
    expect(describeIssue({ code: "SOMETHING_NEW" })).toBe("El servidor reportó una observación (SOMETHING_NEW).");
  });
});

describe("GPX in the browser (limit of the import endpoint, Phase 1 body limit 4.5 MB)", () => {
  test("accepts a .gpx up to the cap and refuses one byte over with a plain message", () => {
    expect(checkGpxFile({ name: "ruta.GPX", size: GPX_MAX_FILE_BYTES })).toEqual({ ok: true });
    const over = checkGpxFile({ name: "ruta.gpx", size: GPX_MAX_FILE_BYTES + 1 });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.message).toContain("3.25 MB");
      expect(over.message).toContain("4.5 MB");
    }
  });
  test("refuses other extensions and empty files", () => {
    expect(checkGpxFile({ name: "ruta.kml", size: 10 }).ok).toBe(false);
    expect(checkGpxFile({ name: "ruta.gpx", size: 0 }).ok).toBe(false);
  });
  test("the cap keeps the base64 envelope under the platform limit", () => {
    const base64Chars = Math.ceil(GPX_MAX_FILE_BYTES / 3) * 4;
    expect(base64Chars + 2_048).toBeLessThan(4_500_000);
  });
  test("bytesToBase64 round-trips, including big inputs", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(Buffer.from(bytesToBase64(big), "base64").equals(Buffer.from(big))).toBe(true);
    expect(bytesToBase64(new TextEncoder().encode("<gpx/>"))).toBe(Buffer.from("<gpx/>").toString("base64"));
  });
  test("server reasons become specific Spanish sentences, a platform 413 too, anything else null", () => {
    expect(gpxFailureReason({ code: "VALIDATION_ERROR", status: 422, details: { field: "gpx_base64", reason: "no_track_or_route_found" } })).toMatch(/ningún track/);
    expect(gpxFailureReason({ code: "VALIDATION_ERROR", status: 422, details: { field: "gpx_base64", reason: "unsafe_xml_construct" } })).toMatch(/DOCTYPE/);
    expect(gpxFailureReason({ code: "VALIDATION_ERROR", status: 422, details: { location: "body", reason: "body_too_large" } })).toMatch(/límite de envío/);
    expect(gpxFailureReason({ code: "NETWORK_ERROR", status: 413, details: {} })).toMatch(/4.5 MB/);
    expect(gpxFailureReason({ code: "INTERNAL_ERROR", status: 500, details: {} })).toBeNull();
  });
});

describe("which revision opens by default", () => {
  const base = { route_revision_id: "", source: "MANUAL" as const, computed_distance_m: null, created_at: "", published_at: null, superseded_at: null };
  test("newest draft, else the published one, else the newest, else none", () => {
    const rev = (n: number, status: "DRAFT" | "PUBLISHED" | "SUPERSEDED") => ({ ...base, route_revision_id: `r${n}`, revision: n, status });
    expect(defaultRevisionId({ active_revision_id: "r2", revisions: [rev(1, "SUPERSEDED"), rev(2, "PUBLISHED"), rev(3, "DRAFT"), rev(4, "DRAFT")] })).toBe("r4");
    expect(defaultRevisionId({ active_revision_id: "r2", revisions: [rev(1, "SUPERSEDED"), rev(2, "PUBLISHED")] })).toBe("r2");
    expect(defaultRevisionId({ active_revision_id: null, revisions: [rev(1, "SUPERSEDED"), rev(2, "SUPERSEDED")] })).toBe("r2");
    expect(defaultRevisionId({ active_revision_id: null, revisions: [] })).toBeNull();
  });
});
