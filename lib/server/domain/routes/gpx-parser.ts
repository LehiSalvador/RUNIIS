import "server-only";
import { XMLParser } from "fast-xml-parser";
import type { z } from "zod";
import { AppError } from "../../http/errors";
import { logEvent } from "../../log";
import { geoJsonLineStringInputSchema, poiInputSchema, poiTypeSchema } from "./contracts";

// SEC-100/101: hardened, server-side-only GPX -> GeoJSON conversion (Master §49). Never fetches
// anything, never trusts fast-xml-parser defaults, and only ever produces a DRAFT RouteRevision
// input (the caller enforces DRAFT; this module has no DB access at all).

// SEC-100: enforced on the decoded byte length, not the base64 string.
// AUD-030 / P1-AC-13: Vercel Functions reject any request body over 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE,
// https://vercel.com/docs/functions/limitations#request-body-size) before the app runs. The JSON/base64
// envelope inflates the file by 4/3, so the former 5 MB decoded cap (~6.7 MB envelope) could never arrive.
// 3_250_000 decoded bytes -> 4_333_336 base64 chars -> at most 4_335_384 envelope bytes, under the
// 4_400_000 request cap below, which stays under the documented 4_500_000 platform limit.
export const GPX_MAX_DECODED_BYTES = 3_250_000;
/** Largest base64 text that decodes to GPX_MAX_DECODED_BYTES (4 chars per 3 bytes, padded). */
export const GPX_MAX_BASE64_CHARS = Math.ceil(GPX_MAX_DECODED_BYTES / 3) * 4;
/** Documented Vercel Functions request-body limit (4.5 MB, decimal) -- never exceed. */
export const VERCEL_MAX_REQUEST_BODY_BYTES = 4_500_000;
/** Budget for `{"source_filename":"...","gpx_base64":"..."}` around the base64 (filename <= 200 chars, escaped). */
export const GPX_ENVELOPE_OVERHEAD_BYTES = 2_048;
/** JSON envelope cap handed to defineRoute; headroom under the platform limit is deliberate. */
export const GPX_MAX_REQUEST_BODY_BYTES = 4_400_000;
const MAX_BYTES = GPX_MAX_DECODED_BYTES;
const MAX_POINTS = 200_000;
const MAX_POIS = 200;
const MAX_NESTED_TAGS = 20;
const TIME_BUDGET_MS = 10_000;

const UNSAFE_XML_MARKERS = /<!doctype|<!entity/i;
const ARRAY_TAGS = new Set(["trk", "trkseg", "trkpt", "rte", "rtept", "wpt"]);

type PoiInput = z.infer<typeof poiInputSchema>;
type PoiType = z.infer<typeof poiTypeSchema>;
type Geometry = z.infer<typeof geoJsonLineStringInputSchema>;

export type GpxParseResult = { geometry: Geometry; pois: PoiInput[] };

export function parseGpxSafely(base64Content: string): GpxParseResult {
  const bytes = decodeBase64Strict(base64Content);
  if (bytes.length > MAX_BYTES) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "file_too_large", max_bytes: MAX_BYTES } });
  }
  const xml = decodeUtf8Strict(bytes);
  if (UNSAFE_XML_MARKERS.test(xml)) {
    // SEC-100: DOCTYPE/ENTITY declarations are refused outright, before the parser ever sees them
    // (billion laughs, quadratic blowup, external SYSTEM entities all require one of these).
    throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "unsafe_xml_construct" } });
  }

  const startedAt = Date.now();
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      processEntities: false, // SEC-100: never expand entities, DOCTYPE is already refused above.
      htmlEntities: false,
      maxNestedTags: MAX_NESTED_TAGS,
      allowBooleanAttributes: false,
      textNodeName: "#text",
      isArray: (name) => ARRAY_TAGS.has(name),
    }).parse(xml, true); // 2nd arg: validate structure first, throw on malformed XML.
  } catch (cause) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "malformed_xml" }, cause });
  }
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > TIME_BUDGET_MS) {
    // The bounded size/nesting/point limits above are the real defense; this only flags a parse that
    // took longer than the Master §49 budget for observability (SEC-100).
    logEvent("warn", "gpx_parse_over_time_budget", { elapsed_ms: elapsedMs });
  }

  const root = readKey(parsed, "gpx");
  if (root === undefined) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "not_a_gpx_file" } });
  }

  const coordinates = extractTrackOrRoute(root);
  if (coordinates.length > MAX_POINTS) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "too_many_points", max: MAX_POINTS } });
  }
  // SEC-101: only the allowlisted fields this module itself read reach the schema; unknown keys
  // (incl. __proto__/constructor, which fast-xml-parser would otherwise assign as an own or
  // prototype-mutating property) never enter the object below because they are never read.
  const geometry = geoJsonLineStringInputSchema.parse({ type: "LineString", coordinates });
  const pois = extractWaypoints(root)
    .slice(0, MAX_POIS)
    .map((poi) => poiInputSchema.parse(poi));

  return { geometry, pois };
}

// ---- Safe, allowlisted-key XML tree access (SEC-101: never spread/iterate unknown parsed keys). ----

function readKey(node: unknown, key: string): unknown {
  return node !== null && typeof node === "object" && Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

function readText(node: unknown, key: string): string | undefined {
  const value = readKey(node, key);
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const text = readKey(value, "#text");
    if (typeof text === "string") return text;
    if (typeof text === "number") return String(text);
  }
  return undefined;
}

/** Strips control characters (matches the SQL cfg_text rule); output is plain text only (SEC-062). */
function sanitizePlainText(input: string): string {
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

function readLatLon(node: unknown): [number, number] {
  const lat = Number(readKey(node, "@_lat"));
  const lon = Number(readKey(node, "@_lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "invalid_coordinate" } });
  }
  return [lon, lat];
}

// Master §49 step 4: detect tracks first, then routes; waypoints alone never form a line. Segments
// within (and across) every <trk> are concatenated in document order (multi-segment tracks).
function extractTrackOrRoute(root: unknown): [number, number][] {
  const trackPoints: [number, number][] = [];
  for (const trk of toArray(readKey(root, "trk"))) {
    for (const seg of toArray(readKey(trk, "trkseg"))) {
      for (const pt of toArray(readKey(seg, "trkpt"))) trackPoints.push(readLatLon(pt));
    }
  }
  if (trackPoints.length >= 2) return trackPoints;

  const routePoints: [number, number][] = [];
  for (const rte of toArray(readKey(root, "rte"))) {
    for (const pt of toArray(readKey(rte, "rtept"))) routePoints.push(readLatLon(pt));
  }
  if (routePoints.length >= 2) return routePoints;

  throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "no_track_or_route_found" } });
}

const POI_TYPE_KEYWORDS: ReadonlyArray<readonly [RegExp, PoiType]> = [
  [/start|salida|inicio/i, "START"],
  [/finish|\bmeta\b|\bend\b|llegada/i, "FINISH"],
  [/hydrat|water|agua|hidrataci/i, "HYDRATION"],
  [/medical|m[eé]dic/i, "MEDICAL"],
  [/checkpoint|control/i, "CHECKPOINT"],
  [/restroom|toilet|ba[ñn]o|sanitario/i, "RESTROOM"],
  [/view|mirador|scenic/i, "VIEWPOINT"],
];

function inferPoiType(name: string, sym: string | undefined): PoiType {
  const haystack = `${name} ${sym ?? ""}`;
  for (const [pattern, type] of POI_TYPE_KEYWORDS) {
    if (pattern.test(haystack)) return type;
  }
  return "OTHER";
}

// <link href> is always dropped (SEC-101: "dropped or https-validated" — GPX waypoints have no
// legitimate need for an outbound link, so this module never carries one into a POI).
function extractWaypoints(root: unknown): PoiInput[] {
  const waypoints = toArray(readKey(root, "wpt"));
  const out: PoiInput[] = [];
  for (const [index, wpt] of waypoints.entries()) {
    const [longitude, latitude] = readLatLon(wpt);
    const fallbackName = `Waypoint ${index + 1}`;
    const name = (sanitizePlainText(readText(wpt, "name") ?? fallbackName) || fallbackName).slice(0, 120);
    const sym = readText(wpt, "sym");
    const rawDescription = readText(wpt, "desc");
    const description = rawDescription ? sanitizePlainText(rawDescription).slice(0, 500) : undefined;
    out.push({
      poi_type: inferPoiType(name, sym),
      name,
      longitude,
      latitude,
      ...(description ? { description } : {}),
    });
  }
  return out;
}

function decodeBase64Strict(input: string): Buffer {
  const compact = input.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "invalid_base64" } });
  }
  return Buffer.from(compact, "base64");
}

function decodeUtf8Strict(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "gpx_base64", reason: "invalid_utf8" }, cause });
  }
}
