import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { JsonObject } from "@/lib/shared/api-contract";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import {
  ATTENDANCE_WORKSPACE_ROW_CAP,
  attendanceFinalizationSchema,
  attendanceResolutionSchema,
  attendanceWorkspaceRowSchema,
  closeEditionResultSchema,
  closureHistoryPageSchema,
  creditLedgerPageSchema,
  finalizationHistoryPageSchema,
  reopenEditionResultSchema,
  reopenFinalizationResultSchema,
  sportingEligibilitySchema,
  type AttendanceWorkspace,
} from "./contracts";

const attendanceRateLimitSchema = z.object({ allowed: z.literal(true) });

// Thin RPC layer over the T41 closure commands (supabase/migrations/20261004100[0-3]00_71[0-3]_*.sql).
// Authorisation (ATTENDANCE_MANAGE / EDITION_CLOSURE_MANAGE, Edition scope derived from the target row, SEC-020),
// per-actor rate limiting (cfg_authorize), idempotent replay, locking and the readiness rules live in the database;
// this layer validates the RPC result shape, adds the truncation marker and logs ids only (never reasons or evidence).

/**
 * The attendance workspace WRITES: it takes the Edition lock briefly and reconciles the attendance universe before it
 * projects it (Master §93). It is therefore never cached (the route answers `private, no-store`) and must be requested
 * explicitly by the UI; the 2000-row cap of the projection is surfaced as `participants_truncated`.
 */
export async function getAttendanceWorkspace(supabase: SupabaseClient, editionId: string): Promise<AttendanceWorkspace> {
  await callRpc(supabase, "consume_actor_rate_limit", { p_scope: "admin.mutation" }, attendanceRateLimitSchema);
  const row = await callRpc(supabase, "attendance_workspace", { p_edition_id: editionId }, attendanceWorkspaceRowSchema);
  return {
    ...row,
    participants_truncated: row.universe_count > row.participants.length,
    participants_cap: ATTENDANCE_WORKSPACE_ROW_CAP,
  };
}

export async function resolveAttendance(
  supabase: SupabaseClient,
  registrationId: string,
  body: { status: string; reason?: string; evidence_metadata?: JsonObject },
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "resolve_attendance",
    {
      p_registration_id: registrationId,
      p_status: body.status,
      p_reason: body.reason ?? null,
      p_evidence_metadata: body.evidence_metadata ?? null,
      p_idempotency_key: idempotencyKey,
    },
    attendanceResolutionSchema,
  );
  logEvent("info", "attendance_resolved", { registration_id: registrationId, status: result.status, source: result.source });
  return result;
}

export async function resolveSportingEligibility(
  supabase: SupabaseClient,
  registrationId: string,
  body: { status: string; distance_credit_disposition: string; reason_code?: string; reason?: string },
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "resolve_sporting_eligibility",
    {
      p_registration_id: registrationId,
      p_status: body.status,
      p_disposition: body.distance_credit_disposition,
      p_reason_code: body.reason_code ?? null,
      p_reason: body.reason ?? null,
      p_idempotency_key: idempotencyKey,
    },
    sportingEligibilitySchema,
  );
  logEvent("info", "sporting_eligibility_resolved", {
    registration_id: registrationId,
    status: result.status,
    disposition: result.distance_credit_disposition,
  });
  return result;
}

export async function finalizeAttendance(
  supabase: SupabaseClient,
  editionId: string,
  body: { mark_remaining_no_show?: boolean; reason?: string },
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "finalize_attendance",
    {
      p_edition_id: editionId,
      p_mark_remaining_no_show: body.mark_remaining_no_show ?? false,
      p_reason: body.reason ?? null,
      p_idempotency_key: idempotencyKey,
    },
    attendanceFinalizationSchema,
  );
  logEvent("info", "attendance_finalized", { edition_id: editionId, revision: result.revision, bulk_no_show: body.mark_remaining_no_show ?? false });
  return result;
}

export async function reopenAttendanceFinalization(supabase: SupabaseClient, editionId: string, reason: string, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "reopen_attendance_finalization",
    { p_edition_id: editionId, p_reason: reason, p_idempotency_key: idempotencyKey },
    reopenFinalizationResultSchema,
  );
  logEvent("info", "attendance_finalization_reopened", { edition_id: editionId });
  return result;
}

export async function closeEdition(supabase: SupabaseClient, editionId: string, idempotencyKey: string | null) {
  const result = await callRpc(supabase, "close_edition", { p_edition_id: editionId, p_idempotency_key: idempotencyKey }, closeEditionResultSchema);
  logEvent("info", "edition_administratively_closed", { edition_id: editionId, credits_created: result.credits_created });
  return result;
}

export async function reopenEdition(supabase: SupabaseClient, editionId: string, reason: string, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "reopen_edition",
    { p_edition_id: editionId, p_reason: reason, p_idempotency_key: idempotencyKey },
    reopenEditionResultSchema,
  );
  logEvent("info", "edition_administrative_closure_reopened", { edition_id: editionId, reversed_credit_count: result.reversed_credit_count });
  return result;
}

// ---- Closure history and credit ledger (P3-T): read-only STABLE database functions, ATTENDANCE_MANAGE on the Edition ----
// They write nothing and take no lock, so unlike the workspace they need no rate-limit slot and no explicit-request guard; the routes still
// answer `private, no-store` (the rows depend on the viewer: staff labels, Edition scope).

type RevisionHistoryFilters = { cursor?: string; limit?: number };

export async function listFinalizationHistory(supabase: SupabaseClient, editionId: string, filters: RevisionHistoryFilters) {
  const page = await callRpc(
    supabase,
    "admin_list_attendance_finalizations",
    { p_edition_id: editionId, p_cursor_revision: decodeRevisionCursor(filters.cursor), p_limit: filters.limit ?? 20 },
    finalizationHistoryPageSchema,
  );
  return { items: page.items, total: page.total, nextCursor: encodeCursor(page.next_cursor) };
}

export async function listClosureHistory(supabase: SupabaseClient, editionId: string, filters: RevisionHistoryFilters) {
  const page = await callRpc(
    supabase,
    "admin_list_administrative_closures",
    { p_edition_id: editionId, p_cursor_revision: decodeRevisionCursor(filters.cursor), p_limit: filters.limit ?? 20 },
    closureHistoryPageSchema,
  );
  return { items: page.items, total: page.total, nextCursor: encodeCursor(page.next_cursor) };
}

export async function listDistanceCredits(
  supabase: SupabaseClient,
  editionId: string,
  filters: { status?: string; modality_id?: string; registration_id?: string; cursor?: string; limit?: number },
) {
  const after = decodeCreditCursor(filters.cursor);
  const page = await callRpc(
    supabase,
    "admin_list_distance_credits",
    {
      p_edition_id: editionId,
      p_status: filters.status ?? null,
      p_modality_id: filters.modality_id ?? null,
      p_registration_id: filters.registration_id ?? null,
      p_cursor_revision: after?.revision ?? null,
      p_cursor_registration_number: after?.registration_number ?? null,
      p_cursor_id: after?.id ?? null,
      p_limit: filters.limit ?? 50,
    },
    creditLedgerPageSchema,
  );
  return { items: page.items, total: page.total, summary: page.summary, nextCursor: encodeCursor(page.next_cursor) };
}

function encodeCursor(next: object | null): string | null {
  return next ? Buffer.from(JSON.stringify(next), "utf8").toString("base64url") : null;
}

function readCursor(cursor: string | undefined): Record<string, unknown> | null {
  if (!cursor) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// An unreadable cursor falls through to the first page, like the other staff list cursors.
function decodeRevisionCursor(cursor: string | undefined): number | null {
  const decoded = readCursor(cursor);
  return decoded && typeof decoded.revision === "number" && Number.isInteger(decoded.revision) && decoded.revision >= 1 ? decoded.revision : null;
}

function decodeCreditCursor(cursor: string | undefined): { revision: number; registration_number: string; id: string } | null {
  const decoded = readCursor(cursor);
  if (!decoded) return null;
  const { revision, registration_number: registrationNumber, id } = decoded;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return null;
  if (typeof registrationNumber !== "string" || registrationNumber === "" || registrationNumber.length > 64) return null;
  if (typeof id !== "string" || !z.guid().safeParse(id).success) return null;
  return { revision, registration_number: registrationNumber, id };
}
