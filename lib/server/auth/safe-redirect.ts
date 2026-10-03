import "server-only";

// SEC-044: `next` is only ever an internal path. Decoded once, it must start with exactly one
// "/" (never "//"/"/\", which browsers treat as protocol-relative or scheme-relative) and its
// top segment must be a known internal route; anything else falls back to the default.
const DEFAULT_NEXT_PATH = "/cuenta";
const ALLOWED_TOP_SEGMENTS = new Set(["", "cuenta", "admin", "scanner"]);
// P2-AC-10.a: the registration flow resumes after sign-in/onboarding, so `/inscripcion/{slug}` is allowed,
// but only as that exact shape: a canonical edition slug (same rule as the database check and the page,
// <= 160 chars), no further segment, query or fragment. It is the only prefix validated beyond its top segment.
const REGISTRATION_PATH = /^\/inscripcion\/(?=.{1,160}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveNextPath(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT_PATH;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT_NEXT_PATH;
  }
  if (decoded === "/") return "/";
  if (decoded[0] !== "/" || decoded[1] === "/" || decoded[1] === "\\" || decoded.includes("\\")) {
    return DEFAULT_NEXT_PATH;
  }
  // A scheme (`javascript:`, `https:`, ...) never starts with "/", but guard explicitly too.
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return DEFAULT_NEXT_PATH;
  const topSegment = decoded.slice(1).split(/[/?#]/)[0];
  if (topSegment === "inscripcion") return REGISTRATION_PATH.test(decoded) ? decoded : DEFAULT_NEXT_PATH;
  return ALLOWED_TOP_SEGMENTS.has(topSegment) ? decoded : DEFAULT_NEXT_PATH;
}
