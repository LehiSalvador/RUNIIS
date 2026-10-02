import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JsonObject } from "@/lib/shared/api-contract";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import {
  administrativeClosureSchema,
  attendanceFinalizationSchema,
  attendanceResolutionSchema,
  attendanceWorkspaceSchema,
  closeEditionResultSchema,
  editionClosureActionResultSchema,
  sportingEligibilitySchema,
} from "./contracts";

// Thin RPC layer over the closure commands (supabase/migrations/2026092818[0-3]00_71[0-3]_*.sql).
// Authorisation (ATTENDANCE_MANAGE / EDITION_CLOSURE_MANAGE / REGISTRATION_MANAGE, scoped from the
// target row), rate limiting, locking and the CloseEdition/ReopenEdition protocols live in the
// database; this layer only validates the RPC result shape and logs.

export async function getAttendanceWorkspace(supabase: SupabaseClient, editionId: string) {
  return callRpc(supabase, "attendance_workspace", { p_edition_id: editionId }, attendanceWorkspaceSchema);
}

export async function resolveAttendance(
  supabase: SupabaseClient,
  registrationId: string,
  status: string,
  reason: string | undefined,
  evidenceMetadata: JsonObject | undefined,
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "resolve_attendance",
    {
      p_registration_id: registrationId,
      p_status: status,
      p_reason: reason ?? null,
      p_evidence_metadata: evidenceMetadata ?? null,
      p_idempotency_key: idempotencyKey,
    },
    attendanceResolutionSchema,
  );
  logEvent("info", "attendance_resolved", { registration_id: registrationId, status });
  return result;
}

export async function resolveSportingEligibility(
  supabase: SupabaseClient,
  registrationId: string,
  status: string,
  disposition: string,
  reasonCode: string | undefined,
  reason: string | undefined,
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "resolve_sporting_eligibility",
    {
      p_registration_id: registrationId,
      p_status: status,
      p_disposition: disposition,
      p_reason_code: reasonCode ?? null,
      p_reason: reason ?? null,
      p_idempotency_key: idempotencyKey,
    },
    sportingEligibilitySchema,
  );
  logEvent("info", "sporting_eligibility_resolved", { registration_id: registrationId, status, disposition });
  return result;
}

export async function finalizeAttendance(
  supabase: SupabaseClient,
  editionId: string,
  markRemainingNoShow: boolean | undefined,
  reason: string | undefined,
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "finalize_attendance",
    {
      p_edition_id: editionId,
      p_mark_remaining_no_show: markRemainingNoShow ?? false,
      p_reason: reason ?? null,
      p_idempotency_key: idempotencyKey,
    },
    attendanceFinalizationSchema,
  );
  logEvent("info", "attendance_finalized", { edition_id: editionId, revision: result.revision });
  return result;
}

export async function reopenAttendanceFinalization(supabase: SupabaseClient, editionId: string, reason: string, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "reopen_attendance_finalization",
    { p_edition_id: editionId, p_reason: reason, p_idempotency_key: idempotencyKey },
    editionClosureActionResultSchema,
  );
  logEvent("info", "attendance_finalization_reopened", { edition_id: editionId });
  return result;
}

export async function closeEdition(supabase: SupabaseClient, editionId: string, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "close_edition",
    { p_edition_id: editionId, p_idempotency_key: idempotencyKey },
    closeEditionResultSchema,
  );
  logEvent("info", "edition_administratively_closed", { edition_id: editionId, credits_created: result.credits_created });
  return result;
}

export async function reopenEdition(supabase: SupabaseClient, editionId: string, reason: string, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "reopen_edition",
    { p_edition_id: editionId, p_reason: reason, p_idempotency_key: idempotencyKey },
    editionClosureActionResultSchema,
  );
  logEvent("info", "edition_administrative_closure_reopened", { edition_id: editionId, reversed_credit_count: result.reversed_credit_count });
  return result;
}
