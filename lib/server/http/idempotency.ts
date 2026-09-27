import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "./errors";

export const IDEMPOTENCY_HEADER = "idempotency-key";
export type IdempotencyMode = "required" | "optional" | "none";
export type IdempotencyInput = { key: string; requestHash: string };

const KEY_FORMAT = /^[A-Za-z0-9._:-]{8,128}$/;

export function readIdempotencyKey(headers: Headers, mode: IdempotencyMode): string | null {
  if (mode === "none") return null;
  const key = headers.get(IDEMPOTENCY_HEADER);
  if (key === null) {
    if (mode === "required") throw new AppError("VALIDATION_ERROR", { details: { header: "Idempotency-Key", reason: "missing" } });
    return null;
  }
  if (!KEY_FORMAT.test(key)) {
    throw new AppError("VALIDATION_ERROR", { details: { header: "Idempotency-Key", reason: "invalid_format" } });
  }
  return key;
}

/** Deterministic JSON: object keys sorted by UTF-16 code unit, no whitespace, `toJSON` honoured. */
export function canonicalJson(value: unknown): string {
  if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return canonicalJson((value as { toJSON: () => unknown }).toJSON());
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number is not canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Unsupported value in canonical JSON: ${typeof value}`);
}

export function computeRequestHash(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body ?? null), "utf8").digest("hex");
}
