import "server-only";
import { z } from "zod";
import { CLOSURE_HISTORY_KINDS, CREDIT_STATUSES } from "@/lib/shared/closure";

// Output and input schemas live in lib/shared/closure.ts (one definition for the server and the admin UI,
// SEC-120 strict output validation). This module only adds the route-param schemas.

export * from "@/lib/shared/closure";

export const editionIdParamSchema = z.strictObject({ editionId: z.guid() });
export const registrationIdParamSchema = z.strictObject({ id: z.guid() });

// ---- Closure history and credit ledger reads (P3-T) ----

/** `kind` is required: finalization and closure revisions are two independently paginated lists (their revision numbers are independent). */
export const closureHistoryQuerySchema = z.strictObject({
  kind: z.enum(CLOSURE_HISTORY_KINDS),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const creditLedgerQuerySchema = z.strictObject({
  status: z.enum(CREDIT_STATUSES).optional(),
  modality_id: z.guid().optional(),
  registration_id: z.guid().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
