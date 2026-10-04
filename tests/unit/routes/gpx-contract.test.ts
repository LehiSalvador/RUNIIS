import { describe, expect, it } from "vitest";
import {
  createManualRevisionBodySchema,
  IMPORT_GPX_MAX_BASE64_CHARS,
  importGpxBodySchema,
  ROUTE_REVISION_MAX_BODY_BYTES,
  updateRevisionBodySchema,
} from "@/lib/server/domain/routes/contracts";
import { GPX_MAX_BASE64_CHARS, GPX_MAX_REQUEST_BODY_BYTES, VERCEL_MAX_REQUEST_BODY_BYTES } from "@/lib/server/domain/routes/gpx-parser";

// AUD-030 / P1-AC-13: the request schema must not admit a payload the Vercel body limit can never deliver.
const body = (chars: number) => ({ source_filename: "route.gpx", gpx_base64: "A".repeat(chars) });

describe("importGpxBodySchema gpx_base64 cap", () => {
  it("equals the GPX_MAX_BASE64_CHARS constant of the parser", () => {
    expect(IMPORT_GPX_MAX_BASE64_CHARS).toBe(GPX_MAX_BASE64_CHARS);
  });

  it("accepts exactly the cap and rejects one character more", () => {
    expect(importGpxBodySchema.safeParse(body(GPX_MAX_BASE64_CHARS)).success).toBe(true);
    expect(importGpxBodySchema.safeParse(body(GPX_MAX_BASE64_CHARS + 1)).success).toBe(false);
  });

  it("rejects the former 7 MB limit and an empty string", () => {
    expect(importGpxBodySchema.safeParse(body(7_000_000)).success).toBe(false);
    expect(importGpxBodySchema.safeParse(body(0)).success).toBe(false);
  });

  it("keeps a maximal envelope under the request cap and the platform limit", () => {
    expect(GPX_MAX_BASE64_CHARS).toBeLessThan(GPX_MAX_REQUEST_BODY_BYTES);
    expect(GPX_MAX_REQUEST_BODY_BYTES).toBeLessThan(VERCEL_MAX_REQUEST_BODY_BYTES);
  });
});

// P3-F-10: PATCH /route-revisions/:id and POST /routes/:id/revisions carry a whole geometry (a real 10K route is far over the 64 KiB default).
describe("route revision body cap (P3-F-10)", () => {
  it("is the import-gpx envelope cap, below the platform limit", () => {
    expect(ROUTE_REVISION_MAX_BODY_BYTES).toBe(GPX_MAX_REQUEST_BODY_BYTES);
    expect(ROUTE_REVISION_MAX_BODY_BYTES).toBeLessThan(VERCEL_MAX_REQUEST_BODY_BYTES);
  });

  it("a 10K-point geometry exceeds the old 64 KiB default, fits the cap with room to spare and passes the schemas", () => {
    const coordinates = Array.from({ length: 10_000 }, (_, i) => [-100.123456 - i * 0.00001, 25.123456 + i * 0.00001]);
    const size = Buffer.byteLength(JSON.stringify({ geometry: { type: "LineString", coordinates } }));
    expect(size).toBeGreaterThan(64 * 1024);
    expect(size).toBeLessThan(ROUTE_REVISION_MAX_BODY_BYTES / 4);
    expect(updateRevisionBodySchema.safeParse({ geometry: { type: "LineString", coordinates } }).success).toBe(true);
    expect(createManualRevisionBodySchema.safeParse({ geometry: { type: "LineString", coordinates } }).success).toBe(true);
  });

  it("the point count stays validated server-side (200 000 max) whatever the byte cap", () => {
    const tooMany = Array.from({ length: 200_001 }, () => [0, 0]);
    expect(updateRevisionBodySchema.safeParse({ geometry: { type: "LineString", coordinates: tooMany } }).success).toBe(false);
  });
});
