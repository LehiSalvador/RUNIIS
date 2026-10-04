/**
 * Pure geometry, payload and labelling helpers of the staff route editor (P3-F). No React, no I/O, so each rule has a unit test.
 * The SERVER stays the authority (Master §46-§50): distances here are a live reference for the operator; the persisted
 * `computed_distance_m`, the validation result and the publish decision always come from the API. Coordinates are [longitude, latitude]
 * (WGS84), the order of the API and of GeoJSON.
 */

export type LonLat = [number, number];

export const POI_TYPES = ["START", "FINISH", "HYDRATION", "MEDICAL", "CHECKPOINT", "RESTROOM", "VIEWPOINT", "OTHER"] as const;
export type PoiType = (typeof POI_TYPES)[number];

export const POI_TYPE_LABEL: Record<PoiType, string> = {
  START: "Salida",
  FINISH: "Meta",
  HYDRATION: "Hidratación",
  MEDICAL: "Servicio médico",
  CHECKPOINT: "Punto de control",
  RESTROOM: "Sanitarios",
  VIEWPOINT: "Mirador",
  OTHER: "Otro",
};

/** Types an operator adds as "points of interest" (start and finish have their own tools). */
export const EXTRA_POI_TYPES: readonly PoiType[] = POI_TYPES.filter((type) => type !== "START" && type !== "FINISH");

export type PoiDraft = {
  /** Client identity (the server id for a saved POI, a generated one for a new POI). */
  key: string;
  poi_type: PoiType;
  name: string;
  description: string;
  longitude: number;
  latitude: number;
};

export type RevisionStatus = "DRAFT" | "PUBLISHED" | "SUPERSEDED";
export type RevisionSource = "MANUAL" | "GPX_IMPORT" | "DUPLICATED";
export type RouteStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type ValidationIssue = { code: string; detail?: Record<string, unknown> };
export type ValidationResult = { valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[]; validated_at?: string };

export type ServerPoi = {
  route_poi_id: string;
  poi_type: string;
  name: string;
  longitude: number;
  latitude: number;
  sort_order: number;
  metadata: Record<string, unknown>;
};

/** GET /api/v1/admin/route-revisions/:id (and the answer of save, create, import and publish). */
export type RevisionFull = {
  route_revision_id: string;
  route_id: string;
  edition_id: string;
  revision: number;
  status: RevisionStatus;
  source: RevisionSource;
  source_filename: string | null;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  computed_distance_m: number | null;
  validation_result: Record<string, unknown>;
  pois: ServerPoi[];
  created_by_staff_id: string;
  /** Staff-safe label (P3-P); absent on older answers. */
  created_by_staff_label?: string;
  created_at: string;
  published_at: string | null;
  superseded_at: string | null;
};

export type RevisionSummary = {
  route_revision_id: string;
  revision: number;
  status: RevisionStatus;
  source: RevisionSource;
  computed_distance_m: number | null;
  created_at: string;
  published_at: string | null;
  superseded_at: string | null;
};

export type RouteRow = {
  route_id: string;
  edition_id: string;
  name: string;
  status: RouteStatus;
  active_revision_id: string | null;
  modality_ids: string[];
  created_at: string;
  updated_at: string;
};

export type RouteDetail = RouteRow & { revisions: RevisionSummary[] };

export type ModalityOption = { modality_id: string; name: string; official_distance_m: number | null; status: string };

// ---------------------------------------------------------------------------------------------
// Limits (mirrors of server rules; the server re-validates all of them)
// ---------------------------------------------------------------------------------------------

export const MAX_POINTS = 200_000;
export const MAX_POIS = 200;
/** Decoded GPX cap of the import endpoint (lib/server/domain/routes/gpx-parser.ts GPX_MAX_DECODED_BYTES); the 4.5 MB Vercel body limit measured in Phase 1 is why it is not 5 MB. */
export const GPX_MAX_FILE_BYTES = 3_250_000;
/**
 * Body cap of PATCH /route-revisions/:id and POST /routes/:id/revisions: those two handlers still use the default 64 KiB request
 * limit (only import-gpx raises it to 4.4 MB), so a geometry of roughly 3 000 points cannot be saved from the editor. A margin is kept for
 * the envelope. When the API raises its limit this single constant is the only thing to change.
 */
export const REVISION_BODY_LIMIT_BYTES = 64 * 1024 - 1024;

// ---------------------------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------------------------

export function isLonLat(value: unknown): value is LonLat {
  return Array.isArray(value) && value.length === 2 && isFiniteIn(value[0], -180, 180) && isFiniteIn(value[1], -90, 90);
}

function isFiniteIn(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Six decimals are ~0.1 m: more only inflates the request. */
export function roundCoord(point: readonly [number, number]): LonLat {
  return [Math.round(point[0] * 1e6) / 1e6, Math.round(point[1] * 1e6) / 1e6];
}

/** "25.6866" / "25,6866" -> number inside the range, else null. */
export function parseCoordinate(text: string, kind: "lat" | "lon"): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  const limit = kind === "lat" ? 90 : 180;
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

export function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineM(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthM(coords: readonly LonLat[]): number {
  let total = 0;
  for (let index = 1; index < coords.length; index += 1) total += haversineM(coords[index - 1], coords[index]);
  return total;
}

/** Cumulative distance from the first point to each point, in metres. */
export function cumulativeM(coords: readonly LonLat[]): number[] {
  const out: number[] = new Array(coords.length);
  let total = 0;
  for (let index = 0; index < coords.length; index += 1) {
    if (index > 0) total += haversineM(coords[index - 1], coords[index]);
    out[index] = total;
  }
  return out;
}

export function formatKm(meters: number | null | undefined, digits = 2): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return "—";
  return `${(meters / 1000).toLocaleString("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

export type Bounds = { west: number; south: number; east: number; north: number };

export function boundsOf(points: readonly (readonly [number, number])[]): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/** Local planar projection (metres) around a reference latitude: exact enough for hit-testing and simplifying one route. */
function project(point: readonly [number, number], refLat: number): [number, number] {
  const k = 111_320;
  return [point[0] * k * Math.cos(toRad(refLat)), point[1] * k];
}

function distPointToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Segment (i -> i+1) closest to a point; used by "insert vertex". Null with fewer than two vertices. */
export function nearestSegment(coords: readonly LonLat[], point: readonly [number, number]): { index: number; distanceM: number } | null {
  if (coords.length < 2) return null;
  const refLat = point[1];
  const p = project(point, refLat);
  let best = { index: 0, distanceM: Infinity };
  let previous = project(coords[0], refLat);
  for (let index = 0; index < coords.length - 1; index += 1) {
    const next = project(coords[index + 1], refLat);
    const distance = distPointToSegment(p, previous, next);
    if (distance < best.distanceM) best = { index, distanceM: distance };
    previous = next;
  }
  return best;
}

/** Index of the vertex closest to a point, with its distance in metres. */
export function nearestVertex(coords: readonly LonLat[], point: readonly [number, number]): { index: number; distanceM: number } | null {
  if (coords.length === 0) return null;
  let best = { index: 0, distanceM: Infinity };
  for (let index = 0; index < coords.length; index += 1) {
    const distance = haversineM(coords[index], point);
    if (distance < best.distanceM) best = { index, distanceM: distance };
  }
  return best;
}

export function midpoint(a: readonly [number, number], b: readonly [number, number]): LonLat {
  return roundCoord([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
}

export function sameCoords(a: readonly LonLat[], b: readonly LonLat[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index][0] !== b[index][0] || a[index][1] !== b[index][1]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Simplification (Douglas-Peucker), only ever applied on an explicit operator action
// ---------------------------------------------------------------------------------------------

/** Iterative Douglas-Peucker: keeps the first and last vertex and every vertex that deviates more than `toleranceM` from the chord. */
export function simplifyRoute(coords: readonly LonLat[], toleranceM: number): LonLat[] {
  if (coords.length <= 2) return coords.map((point) => [point[0], point[1]]);
  const refLat = coords[Math.floor(coords.length / 2)][1];
  const projected = coords.map((point) => project(point, refLat));
  const keep = new Uint8Array(coords.length);
  keep[0] = 1;
  keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let maxDistance = 0;
    let maxIndex = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = distPointToSegment(projected[index], projected[first], projected[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxIndex !== -1 && maxDistance > toleranceM) {
      keep[maxIndex] = 1;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }
  const out: LonLat[] = [];
  for (let index = 0; index < coords.length; index += 1) if (keep[index]) out.push([coords[index][0], coords[index][1]]);
  return out;
}

/** Smallest tolerance (metres, doubling from 1) whose simplification fits `fits`; null when even 500 m does not. */
export function simplifyUntilFits(
  coords: readonly LonLat[],
  fits: (candidate: LonLat[]) => boolean,
): { coords: LonLat[]; toleranceM: number } | null {
  for (let tolerance = 1; tolerance <= 512; tolerance *= 2) {
    const candidate = simplifyRoute(coords, tolerance).map(roundCoord);
    if (candidate.length >= 2 && fits(candidate)) return { coords: candidate, toleranceM: tolerance };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export function newPoiKey(): string {
  return `new-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function isPoiType(value: string): value is PoiType {
  return (POI_TYPES as readonly string[]).includes(value);
}

export function poiFromServer(poi: ServerPoi): PoiDraft {
  const description = typeof poi.metadata?.description === "string" ? poi.metadata.description : "";
  return {
    key: poi.route_poi_id,
    poi_type: isPoiType(poi.poi_type) ? poi.poi_type : "OTHER",
    name: poi.name,
    description,
    longitude: poi.longitude,
    latitude: poi.latitude,
  };
}

/** START first, FINISH last, the rest keep the operator's order: the server stores the index as sort_order. */
export function orderPois<T extends { poi_type: PoiType }>(pois: readonly T[]): T[] {
  const rank = (poi: T) => (poi.poi_type === "START" ? 0 : poi.poi_type === "FINISH" ? 2 : 1);
  return pois.map((poi, index) => ({ poi, index })).sort((a, b) => rank(a.poi) - rank(b.poi) || a.index - b.index).map((entry) => entry.poi);
}

export function poiToInput(poi: PoiDraft) {
  const input: { poi_type: PoiType; name: string; description?: string; longitude: number; latitude: number } = {
    poi_type: poi.poi_type,
    name: poi.name.trim(),
    longitude: roundCoord([poi.longitude, 0])[0],
    latitude: roundCoord([0, poi.latitude])[1],
  };
  const description = poi.description.trim();
  if (description) input.description = description;
  return input;
}

export function geometryInput(coords: readonly LonLat[]) {
  return { type: "LineString" as const, coordinates: coords.map(roundCoord) };
}

export function bodyBytes(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/** What may be sent on its own to the server: the name of every POI is required (1-120 chars), the geometry needs two points. */
export type DraftProblems = { geometry: string | null; pois: Record<string, string> };

export function draftProblems(coords: readonly LonLat[], pois: readonly PoiDraft[]): DraftProblems {
  const problems: DraftProblems = { geometry: null, pois: {} };
  if (coords.length < 2) problems.geometry = "La ruta necesita al menos 2 puntos.";
  else if (coords.length > MAX_POINTS) problems.geometry = `La ruta admite como máximo ${MAX_POINTS.toLocaleString("es-MX")} puntos.`;
  for (const poi of pois) {
    const name = poi.name.trim();
    if (!name) problems.pois[poi.key] = "Escribe un nombre para el punto.";
    else if (name.length > 120) problems.pois[poi.key] = "Máximo 120 caracteres.";
    else if (poi.description.trim().length > 500) problems.pois[poi.key] = "La descripción admite máximo 500 caracteres.";
  }
  if (pois.length > MAX_POIS) problems.geometry = problems.geometry ?? `Se admiten como máximo ${MAX_POIS} puntos de interés.`;
  return problems;
}

export function hasProblems(problems: DraftProblems): boolean {
  return problems.geometry !== null || Object.keys(problems.pois).length > 0;
}

// ---------------------------------------------------------------------------------------------
// Validation result (always produced by the server)
// ---------------------------------------------------------------------------------------------

/** The persisted validation_result is `{}` until the first validation (and after every edit). */
export function parseValidation(value: unknown): ValidationResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.valid !== "boolean" || !Array.isArray(record.errors) || !Array.isArray(record.warnings)) return null;
  const issues = (list: unknown[]): ValidationIssue[] =>
    list
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && typeof (item as { code?: unknown }).code === "string")
      .map((item) => ({ code: item.code as string, detail: item.detail && typeof item.detail === "object" ? (item.detail as Record<string, unknown>) : undefined }));
  return {
    valid: record.valid,
    errors: issues(record.errors),
    warnings: issues(record.warnings),
    validated_at: typeof record.validated_at === "string" ? record.validated_at : undefined,
  };
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Operator-facing sentence for one server validation code (Master §50). Unknown codes degrade to a generic line, never raw text. */
export function describeIssue(issue: ValidationIssue, modalityName?: (id: string) => string | null): string {
  const detail = issue.detail ?? {};
  switch (issue.code) {
    case "GEOMETRY_MISSING":
      return "La revisión no tiene geometría.";
    case "LINESTRING_DEGENERATE":
      return "La ruta necesita al menos 2 puntos distintos.";
    case "INVALID_GEOMETRY":
      return "La geometría de la ruta no es válida.";
    case "COORDINATES_OUT_OF_RANGE":
      return "Hay coordenadas fuera de rango (latitud entre -90 y 90, longitud entre -180 y 180).";
    case "TOO_MANY_POINTS": {
      const count = num(detail.count);
      return `La ruta tiene ${count === null ? "demasiados" : count.toLocaleString("es-MX")} puntos; conviene simplificarla para que cargue rápido.`;
    }
    case "IMPROBABLE_JUMP": {
      const jump = num(detail.max_jump_m);
      return `Hay un salto improbable entre dos puntos seguidos${jump === null ? "" : ` (${jump.toLocaleString("es-MX")} m)`}. Revisa si falta un tramo o hay un punto fuera de lugar.`;
    }
    case "SELF_INTERSECTION":
      return "La ruta se cruza consigo misma. Puede ser correcto (por ejemplo, una vuelta), pero conviene revisarlo.";
    case "START_FINISH_MISSING": {
      const missing = [detail.has_start === false ? "la salida" : null, detail.has_finish === false ? "la meta" : null].filter(Boolean);
      return `Falta definir ${missing.length > 0 ? missing.join(" y ") : "la salida o la meta"}.`;
    }
    case "POI_FAR_FROM_ROUTE": {
      const count = Array.isArray(detail.pois) ? detail.pois.length : null;
      return `${count === null ? "Hay puntos de interés" : count === 1 ? "Un punto de interés está" : `${count} puntos de interés están`} a más de 200 m de la ruta.`;
    }
    case "DISTANCE_MISMATCH": {
      const computed = num(detail.computed_distance_m);
      const official = num(detail.official_distance_m);
      const id = typeof detail.modality_id === "string" ? detail.modality_id : null;
      const name = id && modalityName ? modalityName(id) : null;
      return `La distancia calculada (${formatKm(computed)}) difiere de la oficial${name ? ` de ${name}` : ""} (${formatKm(official)}) en más de 15 %. La distancia oficial no se cambia sola.`;
    }
    default:
      return `El servidor reportó una observación (${issue.code}).`;
  }
}

// ---------------------------------------------------------------------------------------------
// GPX file (checked in the browser before any upload; the server re-checks everything)
// ---------------------------------------------------------------------------------------------

export type GpxCheck = { ok: true } | { ok: false; message: string };

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 2 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1000)).toLocaleString("es-MX")} KB`;
}

export function checkGpxFile(file: { name: string; size: number }): GpxCheck {
  if (!/\.gpx$/i.test(file.name)) return { ok: false, message: "Elige un archivo con extensión .gpx." };
  if (file.size === 0) return { ok: false, message: "El archivo está vacío." };
  if (file.size > GPX_MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `El archivo pesa ${formatBytes(file.size)} y el máximo para importar es ${formatBytes(GPX_MAX_FILE_BYTES)} (la plataforma rechaza envíos de más de 4.5 MB una vez codificados). Reduce los puntos del track en tu aplicación de mapas y vuelve a exportarlo.`,
    };
  }
  return { ok: true };
}

/** base64 of raw bytes, in chunks so a 3 MB file never overflows the argument limit of String.fromCharCode. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

const GPX_REASON_TEXT: Record<string, string> = {
  file_too_large: "El archivo es más grande de lo permitido.",
  unsafe_xml_construct: "El archivo contiene construcciones XML no permitidas (DOCTYPE o ENTITY). Expórtalo de nuevo desde tu aplicación.",
  malformed_xml: "El archivo no es un XML válido. Puede estar dañado o incompleto.",
  not_a_gpx_file: "El archivo no es un GPX (falta el elemento raíz gpx).",
  too_many_points: "El track tiene demasiados puntos. Redúcelos en tu aplicación de mapas y vuelve a exportarlo.",
  invalid_coordinate: "El archivo tiene coordenadas no válidas.",
  no_track_or_route_found: "El archivo no trae ningún track ni ruta con al menos 2 puntos.",
  invalid_base64: "No se pudo leer el archivo. Vuelve a elegirlo.",
  invalid_utf8: "El archivo no está codificado en UTF-8. Expórtalo de nuevo desde tu aplicación.",
};

/** Specific, actionable reason of a refused GPX import (the shared error model still supplies the title, action and request id). */
export function gpxFailureReason(failure: { code: string; status: number; details: Record<string, unknown> }): string | null {
  // The platform answers an over-sized body with a non-JSON 413 before the application runs.
  if (failure.status === 413) return `La plataforma rechazó el envío por tamaño (límite 4.5 MB). Reduce el archivo (máximo ${formatBytes(GPX_MAX_FILE_BYTES)}).`;
  const reason = failure.details.reason;
  if (typeof reason === "string" && GPX_REASON_TEXT[reason]) return GPX_REASON_TEXT[reason];
  if (reason === "body_too_large") return `El archivo supera el límite de envío. Reduce el archivo (máximo ${formatBytes(GPX_MAX_FILE_BYTES)}).`;
  return null;
}

/** The revision to open when the URL names none: the newest DRAFT (work in progress), else the published one, else the newest. */
export function defaultRevisionId(detail: Pick<RouteDetail, "active_revision_id" | "revisions">): string | null {
  const newestFirst = [...detail.revisions].sort((a, b) => b.revision - a.revision);
  return newestFirst.find((entry) => entry.status === "DRAFT")?.route_revision_id ?? detail.active_revision_id ?? newestFirst[0]?.route_revision_id ?? null;
}
