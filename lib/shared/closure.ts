import { z } from "zod";

// Client-safe contract of the T41 closure domain (Master §77-79, §90-102, §175) and the OWN-04 cancellation.
// Single definition shared by the server (strict validation of RPC output, SEC-120) and the admin UI units.
// Mirrors the jsonb projections of supabase/migrations/20261004100[0-3]00_71[0-3]_*.sql exactly: an unexpected
// key fails closed as INTERNAL_ERROR instead of reaching the client.

const id = z.guid();
const timestamp = z.string().min(1);

// ---- Value sets ----

export const ATTENDANCE_STATUSES = ["PENDING", "PRESENT", "NO_SHOW", "EXCLUDED"] as const;
export const ATTENDANCE_RESOLVE_STATUSES = ["PRESENT", "NO_SHOW", "EXCLUDED"] as const;
export const ATTENDANCE_SOURCES = ["INITIAL", "CHECKIN", "MANUAL", "CORRECTION"] as const;
export const ELIGIBILITY_STATUSES = ["ELIGIBLE", "DISQUALIFIED", "EXCLUDED", "PENDING_REVIEW"] as const;
export const CREDIT_DISPOSITIONS = ["ALLOW", "DENY", "PENDING"] as const;
export const GUARDIAN_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;

/** Closed set the participant's cancellation email may mention (OWN-04). The free-text reason is never sent. */
export const CANCEL_REASON_CATEGORIES = [
  "PARTICIPANT_REQUEST",
  "DUPLICATE_REGISTRATION",
  "ELIGIBILITY",
  "EVENT_CHANGE",
  "ADMINISTRATIVE",
  "OTHER",
] as const;
export type CancelReasonCategory = (typeof CANCEL_REASON_CATEGORIES)[number];

/** Spanish labels, identical to the ones the email renders (the participant sees the same wording). */
export const CANCEL_REASON_LABELS: Record<CancelReasonCategory, string> = {
  PARTICIPANT_REQUEST: "Cancelación solicitada por el participante",
  DUPLICATE_REGISTRATION: "Inscripción duplicada",
  ELIGIBILITY: "Requisitos de participación",
  EVENT_CHANGE: "Cambio en el evento",
  ADMINISTRATIVE: "Motivo administrativo",
  OTHER: "Otro motivo",
};

/** Stable codes of the readiness checks (finalize_readiness / close_readiness). `ok: false` blocks the command. */
export const FINALIZE_READINESS_CODES = ["EXECUTION_FINISHED", "NOT_ALREADY_FINALIZED", "NO_PENDING_ATTENDANCE", "NO_PENDING_ELIGIBILITY"] as const;
export const CLOSE_READINESS_CODES = [
  "EXECUTION_FINISHED",
  "NOT_ALREADY_CLOSED",
  "FINALIZATION_CURRENT",
  "UNIVERSE_STABLE",
  "NO_PENDING_ATTENDANCE",
  "NO_PENDING_ELIGIBILITY",
  "GUARDIAN_RESOLVED",
  "NO_OPEN_INTEGRITY_CASE",
  "OFFICIAL_DISTANCE_KNOWN",
  "SPORT_DATE_KNOWN",
] as const;

/** Rows beyond this are not returned by the attendance workspace (`participants_truncated` tells the UI). */
export const ATTENDANCE_WORKSPACE_ROW_CAP = 2000;

// ---- Output schemas ----

export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);
export const attendanceSourceSchema = z.enum(ATTENDANCE_SOURCES);
export const eligibilityStatusSchema = z.enum(ELIGIBILITY_STATUSES);
export const creditDispositionSchema = z.enum(CREDIT_DISPOSITIONS);

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
  /** Staff-safe label (P3-P, private.staff_display_label); viewer-dependent, optional so older fixtures keep parsing. */
  resolved_by_staff_label: z.string().nullable().optional(),
  resolved_at: timestamp,
});

export const sportingEligibilitySchema = z.strictObject({
  sporting_eligibility_resolution_id: id,
  registration_id: id,
  revision: z.int(),
  status: eligibilityStatusSchema,
  distance_credit_disposition: creditDispositionSchema,
  reason_code: z.string().nullable(),
  reason: z.string().nullable(),
  resolved_by_staff_id: id.nullable(),
  /** Staff-safe label (P3-P, private.staff_display_label); viewer-dependent, optional so older fixtures keep parsing. */
  resolved_by_staff_label: z.string().nullable().optional(),
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
  finalized_by_staff_label: z.string().nullable().optional(),
  finalized_at: timestamp,
});

export const administrativeClosureSchema = z.strictObject({
  administrative_closure_id: id,
  edition_id: id,
  revision: z.int(),
  attendance_finalization_id: id,
  status: z.literal("CLOSED"),
  closed_by_staff_id: id,
  closed_by_staff_label: z.string().nullable().optional(),
  closed_at: timestamp,
});

/** close: the closure projection plus the number of DistanceCredits created in the same transaction. */
export const closeEditionResultSchema = administrativeClosureSchema.extend({ credits_created: z.int() });

/** reopen attendance finalization: the finalization is SUPERSEDED, attendance is editable again. */
export const reopenFinalizationResultSchema = z.strictObject({ edition_id: id, reopened: z.literal(true) });

/** reopen edition (administrative closure): every ACTIVE DistanceCredit of the Edition is REVERSED. */
export const reopenEditionResultSchema = z.strictObject({ edition_id: id, reopened: z.literal(true), reversed_credit_count: z.int() });

export const readinessCheckSchema = z.strictObject({ code: z.string(), ok: z.boolean(), detail: z.record(z.string(), z.unknown()).optional() });
export const finalizeReadinessSchema = z.strictObject({ ready: z.boolean(), checks: z.array(readinessCheckSchema), expected_count: z.int() });
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
    distance_credit_disposition: creditDispositionSchema.nullable(),
    reason_code: z.string().nullable(),
    resolved_at: timestamp.nullable(),
  }),
  guardian_status: z.enum(GUARDIAN_STATUSES).nullable(),
  has_active_credit: z.boolean(),
});

/** The jsonb the database returns (counts are sparse: a status with no rows is absent). */
export const attendanceWorkspaceRowSchema = z.strictObject({
  edition_id: id,
  universe_count: z.int(),
  attendance_counts: z.partialRecord(attendanceStatusSchema, z.int()),
  eligibility_counts: z.partialRecord(eligibilityStatusSchema, z.int()),
  disposition_pending_count: z.int(),
  current_finalization: attendanceFinalizationSchema.nullable(),
  current_closure: administrativeClosureSchema.nullable(),
  finalize_readiness: finalizeReadinessSchema,
  close_readiness: closeReadinessSchema,
  participants: z.array(workspaceParticipantSchema),
});

/** What the API returns: the database row plus the explicit truncation marker. */
export const attendanceWorkspaceSchema = attendanceWorkspaceRowSchema.extend({
  participants_truncated: z.boolean(),
  participants_cap: z.literal(ATTENDANCE_WORKSPACE_ROW_CAP),
});

export const registrationStatusSchema = z.strictObject({
  registration_id: id,
  registration_number: z.string(),
  status: z.string(),
  modality_id: id,
  canceled_at: timestamp.nullable(),
  cancel_reason: z.string().nullable(),
});

/**
 * OWN-04 outcome of the cancellation email (P3SECA-06). `queued`: the participant (the buyer for a Guest) will be emailed by the outbox;
 * `suppressed`: their contact is on the suppression list; `no_contact`: no email contact point exists; `unknown`: the outcome could not be
 * read right now (the cancellation itself succeeded). For `suppressed` and `no_contact` an ACTION_REQUIRED task for staff follow-up is open
 * (`follow_up_task_id`, task_key `registration-cancel-notice:{registration_id}`, category COMMUNICATIONS).
 */
export const CANCEL_NOTIFICATION_STATUSES = ["queued", "suppressed", "no_contact", "unknown"] as const;
export const cancelNotificationSchema = z.strictObject({
  status: z.enum(CANCEL_NOTIFICATION_STATUSES),
  follow_up_task_id: id.nullable(),
});

/** POST /admin/registrations/:id/cancel response: the registration status plus the notification outcome (additive; the other keys are unchanged). */
export const cancelRegistrationResultSchema = registrationStatusSchema.extend({ notification: cancelNotificationSchema });

export const changeModalityResultSchema = z.strictObject({
  registration_id: id,
  modality_id: id,
  category_id: id.nullable(),
  revision: z.int(),
  official_distance_impact: z.strictObject({
    from_m: z.int().nullable(),
    to_m: z.int().nullable(),
    from_generates_credit: z.boolean(),
    to_generates_credit: z.boolean(),
  }),
});

export type AttendanceWorkspace = z.output<typeof attendanceWorkspaceSchema>;
export type AttendanceWorkspaceParticipant = AttendanceWorkspace["participants"][number];
export type AttendanceResolution = z.output<typeof attendanceResolutionSchema>;
export type SportingEligibility = z.output<typeof sportingEligibilitySchema>;
export type AttendanceFinalization = z.output<typeof attendanceFinalizationSchema>;
export type AdministrativeClosure = z.output<typeof administrativeClosureSchema>;
export type CloseEditionResult = z.output<typeof closeEditionResultSchema>;
export type ReopenFinalizationResult = z.output<typeof reopenFinalizationResultSchema>;
export type ReopenEditionResult = z.output<typeof reopenEditionResultSchema>;
export type RegistrationStatus = z.output<typeof registrationStatusSchema>;
export type CancelNotification = z.output<typeof cancelNotificationSchema>;
export type CancelRegistrationResult = z.output<typeof cancelRegistrationResultSchema>;
export type ChangeModalityResult = z.output<typeof changeModalityResultSchema>;

// ---- Request bodies (strict: unknown fields are rejected). Bounds mirror the SQL validators. ----

const reason = z.string().trim().min(1).max(500);

/** PRESENT needs `reason` and a non-empty `evidence_metadata` (<= 4 KB serialized); EXCLUDED needs `reason`; NO_SHOW needs neither. */
export const resolveAttendanceBodySchema = z
  .strictObject({
    status: z.enum(ATTENDANCE_RESOLVE_STATUSES),
    reason: reason.optional(),
    evidence_metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((body, ctx) => {
    if ((body.status === "PRESENT" || body.status === "EXCLUDED") && body.reason === undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "required" });
    }
    if (body.status === "PRESENT" && (body.evidence_metadata === undefined || Object.keys(body.evidence_metadata).length === 0)) {
      ctx.addIssue({ code: "custom", path: ["evidence_metadata"], message: "required" });
    }
    if (body.evidence_metadata !== undefined && JSON.stringify(body.evidence_metadata).length > 4096) {
      ctx.addIssue({ code: "custom", path: ["evidence_metadata"], message: "too_long" });
    }
  });

/** DISQUALIFIED/EXCLUDED need `reason`; PENDING_REVIEW can only carry disposition PENDING. */
export const resolveSportingEligibilityBodySchema = z
  .strictObject({
    status: eligibilityStatusSchema,
    distance_credit_disposition: creditDispositionSchema,
    reason_code: z.string().trim().min(1).max(64).optional(),
    reason: reason.optional(),
  })
  .superRefine((body, ctx) => {
    if ((body.status === "DISQUALIFIED" || body.status === "EXCLUDED") && body.reason === undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "required" });
    }
    if (body.status === "PENDING_REVIEW" && body.distance_credit_disposition !== "PENDING") {
      ctx.addIssue({ code: "custom", path: ["distance_credit_disposition"], message: "pending_review_requires_pending" });
    }
  });

/** `mark_remaining_no_show: true` (explicit scope confirmation) requires `reason`; it only ever touches PENDING rows. */
export const finalizeAttendanceBodySchema = z
  .strictObject({ mark_remaining_no_show: z.boolean().optional(), reason: reason.optional() })
  .superRefine((body, ctx) => {
    if (body.mark_remaining_no_show === true && body.reason === undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "required" });
    }
  });

export const reopenWithReasonBodySchema = z.strictObject({ reason });
export const closeEditionBodySchema = z.strictObject({});

export const cancelRegistrationBodySchema = z.strictObject({
  reason,
  reason_category: z.enum(CANCEL_REASON_CATEGORIES).optional(),
});

/** `category_id` is required when the target modality has USER_SELECTS categories (database answers FORM_INVALID otherwise). */
export const changeModalityBodySchema = z.strictObject({
  new_modality_id: id,
  category_id: id.nullable().optional(),
  reason,
});
