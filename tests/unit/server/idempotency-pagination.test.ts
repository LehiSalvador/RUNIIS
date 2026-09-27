import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/server/http/errors";
import { canonicalJson, computeRequestHash, readIdempotencyKey } from "@/lib/server/http/idempotency";
import { decodeCursor, encodeCursor, paginationQuerySchema } from "@/lib/server/http/pagination";

const headers = (key?: string) => new Headers(key === undefined ? {} : { "Idempotency-Key": key });

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error("expected AppError");
}

describe("readIdempotencyKey", () => {
  it("honours the route mode", () => {
    expect(readIdempotencyKey(headers("a1b2c3d4-e5f6"), "none")).toBeNull();
    expect(readIdempotencyKey(headers(), "optional")).toBeNull();
    expect(readIdempotencyKey(headers("0b8f7c5e-1d2a-4f3b-9c8d-7e6f5a4b3c2d"), "required")).toBe("0b8f7c5e-1d2a-4f3b-9c8d-7e6f5a4b3c2d");
    expect(codeOf(() => readIdempotencyKey(headers(), "required"))).toBe("VALIDATION_ERROR");
  });

  it.each(["short", "x".repeat(129), "has space in it", "semi;colon-key", "ñandú-key-000"])("rejects malformed key %j", (key) => {
    expect(codeOf(() => readIdempotencyKey(headers(key), "optional"))).toBe("VALIDATION_ERROR");
  });
});

describe("canonical request hash", () => {
  it("is independent of key order and whitespace", () => {
    const a = { b: 1, a: { d: [1, "x", null], c: true } };
    const b = JSON.parse('{ "a": { "c": true, "d": [1, "x", null] }, "b": 1 }');
    expect(canonicalJson(a)).toBe('{"a":{"c":true,"d":[1,"x",null]},"b":1}');
    expect(computeRequestHash(a)).toBe(computeRequestHash(b));
  });

  it("is sha256 hex of the canonical JSON and changes with content", () => {
    expect(computeRequestHash({ a: 1 })).toBe(createHash("sha256").update('{"a":1}').digest("hex"));
    expect(computeRequestHash({ a: 1 })).not.toBe(computeRequestHash({ a: 2 }));
    expect(computeRequestHash(undefined)).toBe(createHash("sha256").update("null").digest("hex"));
  });

  it("drops undefined properties, serialises dates via toJSON and refuses non-finite numbers", () => {
    expect(canonicalJson({ a: undefined, b: new Date("2026-01-02T03:04:05.000Z") })).toBe('{"b":"2026-01-02T03:04:05.000Z"}');
    expect(canonicalJson([undefined])).toBe("[null]");
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
  });
});

describe("cursor pagination", () => {
  const position = z.strictObject({ starts_at: z.string(), id: z.uuid() });

  it("roundtrips an opaque base64url cursor", () => {
    const cursor = encodeCursor({ starts_at: "2026-10-01T10:00:00Z", id: "0b8f7c5e-1d2a-4f3b-9c8d-7e6f5a4b3c2d" });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, position)).toEqual({ starts_at: "2026-10-01T10:00:00Z", id: "0b8f7c5e-1d2a-4f3b-9c8d-7e6f5a4b3c2d" });
  });

  it.each([
    ["not base64url", "***"],
    ["not json", Buffer.from("{oops").toString("base64url")],
    ["wrong shape", encodeCursor({ starts_at: 1 })],
    ["unknown field", encodeCursor({ starts_at: "x", id: "0b8f7c5e-1d2a-4f3b-9c8d-7e6f5a4b3c2d", admin: true })],
    ["too long", "A".repeat(513)],
  ])("rejects a tampered cursor (%s)", (_label, cursor) => {
    expect(codeOf(() => decodeCursor(cursor, position))).toBe("VALIDATION_ERROR");
  });

  it("bounds the page limit", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(paginationQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(paginationQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});
