import { describe, expect, test } from "vitest";
import { readKeyset, writeKeyset } from "@/lib/server/domain/people/paging";
import { AppError } from "@/lib/server/http/errors";

describe("people keyset paging", () => {
  test("undefined cursor reads as no position", () => {
    expect(readKeyset(undefined)).toBeNull();
  });

  test("writeKeyset(null) produces no cursor", () => {
    expect(writeKeyset(null)).toBeNull();
  });

  test("round-trips a next_cursor through the client-facing string", () => {
    const next = { sort_key: "jose nunez", id: "10000000-0000-4000-8000-000000000001" };
    const cursor = writeKeyset(next);
    expect(cursor).toBeTypeOf("string");
    const read = readKeyset(cursor ?? undefined);
    expect(read).toEqual({ sortKey: next.sort_key, id: next.id });
  });

  test("a tampered cursor (not our jsonb shape) is rejected as VALIDATION_ERROR, not a crash", () => {
    const bogus = Buffer.from(JSON.stringify({ k: "x" }), "utf8").toString("base64url"); // missing id
    expect(() => readKeyset(bogus)).toThrow(AppError);
    try {
      readKeyset(bogus);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION_ERROR");
    }
  });
});
