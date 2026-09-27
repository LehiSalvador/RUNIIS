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
