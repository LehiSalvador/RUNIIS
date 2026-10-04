import "server-only";
import { z } from "zod";
import type { JsonObject } from "@/lib/shared/api-contract";
import { AppError } from "./errors";

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 512;

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

const CURSOR_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2})(?::?(\d{2}))?)$/;

/**
 * Whether `value` is a real timestamp a keyset cursor may carry (what PostgREST/Postgres print for timestamptz:
 * `2026-10-04T12:00:00.123456+00:00`). A cursor is client-tampered input that reaches a timestamptz RPC parameter, so a
 * malformed value must be a 400 here, never a Postgres cast error (500) there (P3SECA-09).
 */
export function isCursorTimestamp(value: string): boolean {
  if (value.length > 64) return false;
  const match = CURSOR_TIMESTAMP_RE.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  // Postgres rejects a zone displacement beyond 15:59.
  if (match[7] !== undefined && (Number(match[7]) > 15 || Number(match[8] ?? 0) > 59)) return false;
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0);
  return day >= 1 && day <= lastDay.getUTCDate();
}

/** Zod schema for the timestamp field of a keyset cursor. */
export const cursorTimestampSchema = z.string().refine(isCursorTimestamp, { message: "invalid_cursor_timestamp" });

// Cursors are opaque to clients but not secret or signed: they only carry keyset positions,
// and every query still runs under the caller's own authorisation.
export function encodeCursor(position: JsonObject): string {
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

export function decodeCursor<S extends z.ZodType>(cursor: string, schema: S): z.output<S> {
  const invalid = () => new AppError("VALIDATION_ERROR", { details: { field: "cursor", reason: "invalid_cursor" } });
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  const result = schema.safeParse(decoded);
  if (!result.success) throw invalid();
  return result.data;
}
