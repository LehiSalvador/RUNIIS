import "server-only";
import { z } from "zod";

// Output schemas mirror the jsonb projections in supabase/migrations/2026092818[0-3]00_71[0-3]_*.sql
// exactly (private.*_projection / private.attendance_workspace): an unexpected key fails closed as
// INTERNAL_ERROR instead of reaching the client (SEC-120).

const id = z.guid();
const timestamp = z.string().min(1);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const attendanceStatusSchema = z.enum(["PENDING", "PRESENT", "NO_SHOW", "EXCLUDED"]);
export const attendanceSourceSchema = z.enum(["INITIAL", "CHECKIN", "MANUAL", "CORRECTION"]);
export const eligibilityStatusSchema = z.enum(["ELIGIBLE", "DISQUALIFIED", "EXCLUDED", "PENDING_REVIEW"]);
export const distanceCreditDispositionSchema = z.enum(["ALLOW", "DENY", "PENDING"]);

export const attendanceResolutionSchema = z.strictObject({
  attendance_resolution_id: id,
  registration_id: id,
  revision: z.int(),
  status: attendanceStatusSchema,
  source: attendanceSourceSchema,
  checkin_id: id.nullable(),
  reason: z.string().nullable(),
  evidence_metadata: z.record(z.string(), z.unknown()),
  resolved_by_staff_id: id.nullable(),
  resolved_at: timestamp,
});

export const sportingEligibilitySchema = z.strictObject({
  sporting_eligibility_resolution_id: id,
  registration_id: id,
  revision: z.int(),
  status: eligibilityStatusSchema,
  distance_credit_disposition: distanceCreditDispositionSchema,
  reason_code: z.string().nullable(),
  reason: z.string().nullable(),
  resolved_by_staff_id: id.nullable(),
  resolved_at: timestamp,
});

export const attendanceFinalizationSchema = z.strictObject({
  attendance_finalization_id: id,
  edition_id: id,
  revision: z.int(),
  status: z.literal("FINALIZED"),
  expected_count: z.int(),
  present_count: z.int(),
  no_show_count: z.int(),
  excluded_count: z.int(),
  finalized_by_staff_id: id,
  finalized_at: timestamp,
});

export const administrativeClosureSchema = z.strictObject({
  administrative_closure_id: id,
  edition_id: id,
  revision: z.int(),
  attendance_finalization_id: id,
  status: z.literal("CLOSED"),
  closed_by_staff_id: id,
  closed_at: timestamp,
});

export const closeEditionResultSchema = administrativeClosureSchema.extend({ credits_created: z.int() });

export const readinessCheckSchema = z.strictObject({ code: z.string(), ok: z.boolean(), detail: z.unknown().optional() });
export const finalizeReadinessSchema = z.strictObject({
  ready: z.boolean(),
  checks: z.array(readinessCheckSchema),
  expected_count: z.int(),
});
export const closeReadinessSchema = z.strictObject({ ready: z.boolean(), checks: z.array(readinessCheckSchema) });

const workspaceParticipantSchema = z.strictObject({
  registration_id: id,
  registration_number: z.string(),
  participant_kind: z.enum(["PROFILE", "GUEST"]),
  display_name: z.string().nullable(),
  modality: z.strictObject({ modality_id: id, name: z.string() }),
  attendance: z.strictObject({
    status: attendanceStatusSchema.nullable(),
    source: attendanceSourceSchema.nullable(),
    reason: z.string().nullable(),
    resolved_at: timestamp.nullable(),
  }),
  eligibility: z.strictObject({
    status: eligibilityStatusSchema.nullable(),
    distance_credit_disposition: distanceCreditDispositionSchema.nullable(),
    reason_code: z.string().nullable(),
    resolved_at: timestamp.nullable(),
  }),
  guardian_status: z.enum(["PENDING", "VERIFIED", "REJECTED"]).nullable(),
  has_active_credit: z.boolean(),
});

export const attendanceWorkspaceSchema = z.strictObject({
  edition_id: id,
  universe_count: z.int(),
  attendance_counts: z.record(attendanceStatusSchema, z.int()),
  eligibility_counts: z.record(eligibilityStatusSchema, z.int()),
  disposition_pending_count: z.int(),
  current_finalization: attendanceFinalizationSchema.nullable(),
  current_closure: administrativeClosureSchema.nullable(),
  finalize_readiness: finalizeReadinessSchema,
  close_readiness: closeReadinessSchema,
  participants: z.array(workspaceParticipantSchema),
});

export const editionClosureActionResultSchema = z.strictObject({
  edition_id: id,
  reopened: z.literal(true),
  reversed_credit_count: z.int().nullable().optional(),
});

// ---- Input schemas ----

export const resolveAttendanceBodySchema = z.strictObject({
  status: z.enum(["PRESENT", "NO_SHOW", "EXCLUDED"]),
  reason: z.string().trim().min(1).max(500).optional(),
  evidence_metadata: z.record(z.string(), z.unknown()).optional(),
});

export const resolveSportingEligibilityBodySchema = z.strictObject({
  status: eligibilityStatusSchema,
  distance_credit_disposition: distanceCreditDispositionSchema,
  reason_code: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const finalizeAttendanceBodySchema = z.strictObject({
  mark_remaining_no_show: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const reopenAttendanceBodySchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export const closeEditionBodySchema = z.strictObject({});
export const reopenEditionBodySchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });

export const registrationIdParamSchema = z.strictObject({ id });
export const editionIdParamSchema = z.strictObject({ editionId: id });

export type AttendanceWorkspace = z.output<typeof attendanceWorkspaceSchema>;
export type DateStr = z.output<typeof dateStr>;
