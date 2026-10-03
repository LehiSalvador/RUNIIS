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
