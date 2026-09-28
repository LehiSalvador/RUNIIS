import "server-only";

// SEC-044: `next` is only ever an internal path. Decoded once, it must start with exactly one
// "/" (never "//"/"/\", which browsers treat as protocol-relative or scheme-relative) and its
// top segment must be a known internal route; anything else falls back to the default.
const DEFAULT_NEXT_PATH = "/cuenta";
const ALLOWED_TOP_SEGMENTS = new Set(["", "cuenta", "admin", "scanner"]);

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
  return ALLOWED_TOP_SEGMENTS.has(topSegment) ? decoded : DEFAULT_NEXT_PATH;
}
