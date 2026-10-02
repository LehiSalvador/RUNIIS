import { describe, expect, it } from "vitest";
import { IMPORT_GPX_MAX_BASE64_CHARS, importGpxBodySchema } from "@/lib/server/domain/routes/contracts";
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
