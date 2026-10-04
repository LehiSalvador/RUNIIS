import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cursorTimestampSchema, decodeCursor, encodeCursor, isCursorTimestamp } from "@/lib/server/http/pagination";

// P3SECA-09: a tampered timestamp cursor must be a 400 (invalid_cursor) at the edge, never a Postgres cast error (500) in the RPC.

describe("isCursorTimestamp", () => {
  it.each([
    "2026-10-04T12:00:00+00:00",
    "2026-10-04T12:00:00.123456+00:00",
    "2026-10-04T12:00:00.1Z",
    "2026-10-04 12:00:00.123456+00",
    "2026-10-04T12:00:00-06:00",
    "2028-02-29T00:00:00Z",
    "2026-10-04T12:00:00+0530",
  ])("accepts what Postgres prints: %s", (value) => {
    expect(isCursorTimestamp(value)).toBe(true);
  });

  it.each([
    "",
    "tampered",
    "2026-10-04",
    "2026-13-04T12:00:00Z",
    "2026-02-30T12:00:00Z",
    "2027-02-29T00:00:00Z",
    "2026-10-04T24:00:00Z",
    "2026-10-04T12:60:00Z",
    "2026-10-04T12:00:00",
    "0000-01-01T00:00:00Z",
    "2026-10-04T12:00:00+99:00",
    "2026-10-04T12:00:00Z'; drop table x;--",
    "2026-10-04T12:00:00.1234567Z",
    `2026-10-04T12:00:00Z${" ".repeat(70)}`,
  ])("rejects %j", (value) => {
    expect(isCursorTimestamp(value)).toBe(false);
  });
});

describe("keyset cursor with a timestamp field", () => {
  const schema = z.strictObject({ rank: z.int(), detected_at: cursorTimestampSchema, id: z.guid() });
  const id = "11111111-1111-4111-8111-111111111111";

  it("decodes a genuine cursor", () => {
    const cursor = encodeCursor({ rank: 2, detected_at: "2026-10-04T12:00:00.123456+00:00", id });
    expect(decodeCursor(cursor, schema)).toEqual({ rank: 2, detected_at: "2026-10-04T12:00:00.123456+00:00", id });
  });

  it("answers VALIDATION_ERROR invalid_cursor for a tampered timestamp", () => {
    const cursor = encodeCursor({ rank: 2, detected_at: "not-a-timestamp", id });
    expect(() => decodeCursor(cursor, schema)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR", details: { field: "cursor", reason: "invalid_cursor" } }),
    );
  });
});
