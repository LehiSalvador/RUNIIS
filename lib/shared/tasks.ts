import { z } from "zod";

// Client-safe contract of the staff Task Center (Master §142-143, Roadmap §9.26; P3-D). Single definition shared by the server (strict
// validation of RPC output, SEC-120) and the admin UI units. Mirrors the jsonb projections of
// supabase/migrations/20261005100000_720_task_center.sql exactly: an unexpected key fails closed as INTERNAL_ERROR.
//
// A task is a PROJECTION of a source condition and points to its root object; it is never the source of truth.

const id = z.guid();
const timestamp = z.string().min(1);

export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL", "RESOLVED", "WAIVED"] as const;
export const TASK_BLOCKING_LEVELS = ["INFORMATION", "ACTION_REQUIRED", "EVENT_DAY_BLOCKER", "CLOSURE_BLOCKER"] as const;
export const TASK_ASSIGNED_ROLES = ["ADMIN", "OPERATOR", "CHECKIN", "MODERATOR"] as const;
/** `ACTIVE` (default) = not RESOLVED/WAIVED; `ALL` = everything. */
export const TASK_STATUS_FILTERS = ["ACTIVE", "ALL", ...TASK_STATUSES] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskBlockingLevel = (typeof TASK_BLOCKING_LEVELS)[number];

/** Categories the platform emits today (free text in the database; filter by any uppercase identifier). */
export const TASK_CATEGORIES = ["ATTENDANCE", "CLOSURE", "INTEGRITY", "RECONCILIATION", "ANTI_HOARDING", "COMMUNICATIONS", "RACE_DAY"] as const;

/** `resolution_type` values: MANUAL / WAIVED by staff, CONDITION_CLEARED by the system when the source no longer holds. */
export const TASK_RESOLUTION_TYPES = ["MANUAL", "WAIVED", "CONDITION_CLEARED"] as const;

/**
 * Stable `source_rule` (= the first segment of `task_key`) of every writer. The rules marked blocker open CLOSURE_BLOCKER tasks.
 * Task kinds of Roadmap §9.26: attendance pending, closure pending, communication failure, provider reconciliation, integrity issue.
 */
export const TASK_SOURCE_RULES = [
  "attendance-finalization", // attendance pending (CLOSURE_BLOCKER)
  "closure-pending", // closure pending (ACTION_REQUIRED)
  "closure-integrity", // integrity issue (CLOSURE_BLOCKER when the case blocks closure)
  "provider-reconciliation", // provider reconciliation (platform-wide)
  "hold-concentration", // OD-P2-01 hoarding alert
  "registration-cancel-notice", // OWN-04: the cancellation email could not go out (no contact / suppressed)
  "communication-critical-failure", // communication failure
  "communication-quota-exhausted",
  "outbox-escalated",
  "raceday_unknown_pass_burst",
] as const;

export const taskSchema = z.strictObject({
  admin_task_id: id,
  task_key: z.string(),
  category: z.string(),
  scope_type: z.string(),
  scope_id: id.nullable(),
  edition_id: id.nullable(),
  related_entity_type: z.string().nullable(),
  related_entity_id: id.nullable(),
  title: z.string(),
  description: z.string(),
  priority: z.string(),
  blocking_level: z.enum(TASK_BLOCKING_LEVELS),
  status: z.enum(TASK_STATUSES),
  assigned_role: z.enum(TASK_ASSIGNED_ROLES).nullable(),
  assigned_staff_id: id.nullable(),
  // Staff-safe label for the assignee (P3-O): "First L." for ADMIN/OPERATOR viewers, "Staff #abc123" otherwise, null while unassigned. Optional so
  // older fixtures keep parsing; the database always sends it.
  assigned_staff_label: z.string().nullable().optional(),
  detected_at: timestamp,
  due_at: timestamp.nullable(),
  started_at: timestamp.nullable(),
  resolved_at: timestamp.nullable(),
  resolution_type: z.string().nullable(),
  resolution_reason: z.string().nullable(),
  source_rule: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: timestamp,
  updated_at: timestamp,
});

/** GET one adds whether the root condition still holds right now (CLOSURE_BLOCKER tasks cannot be resolved/waived while it does). */
export const taskDetailSchema = taskSchema.extend({ source_holds: z.boolean() });

export const taskListPageSchema = z.strictObject({
  items: z.array(taskSchema),
  counts: z.strictObject({
    by_status: z.partialRecord(z.enum(TASK_STATUSES), z.int()),
    active_by_blocking_level: z.partialRecord(z.enum(TASK_BLOCKING_LEVELS), z.int()),
  }),
  next_cursor: z.strictObject({ rank: z.int(), detected_at: timestamp, id }).nullable(),
});

export const refreshTasksResultSchema = z.strictObject({ edition_id: id, opened: z.int(), cleared: z.int(), errors: z.int() });

// ---- Root object link hint ----

/** Where the UI sends the user to act on the root object. The UI maps `section` to its own route; the task never carries a URL. */
export const TASK_ROOT_SECTIONS = [
  "attendance",
  "closure",
  "integrity",
  "communications",
  "registration-requests",
  "check-in",
  "edition",
  "platform",
] as const;
export type TaskRootSection = (typeof TASK_ROOT_SECTIONS)[number];

export type TaskRoot = {
  section: TaskRootSection;
  edition_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
};

const SECTION_BY_RULE: Readonly<Record<string, TaskRootSection>> = {
  "attendance-finalization": "attendance",
  "closure-pending": "closure",
  "closure-integrity": "integrity",
  "provider-reconciliation": "communications",
  "hold-concentration": "registration-requests",
  "communication-critical-failure": "communications",
  "communication-quota-exhausted": "communications",
  "outbox-escalated": "platform",
  raceday_unknown_pass_burst: "check-in",
};

export function taskRoot(task: Pick<z.output<typeof taskSchema>, "source_rule" | "edition_id" | "related_entity_type" | "related_entity_id">): TaskRoot {
  return {
    section: SECTION_BY_RULE[task.source_rule] ?? (task.edition_id ? "edition" : "platform"),
    edition_id: task.edition_id,
    entity_type: task.related_entity_type,
    entity_id: task.related_entity_id,
  };
}

export const taskViewSchema = taskSchema.extend({
  root: z.strictObject({
    section: z.enum(TASK_ROOT_SECTIONS),
    edition_id: id.nullable(),
    entity_type: z.string().nullable(),
    entity_id: id.nullable(),
  }),
});
export const taskDetailViewSchema = taskDetailSchema.extend({ root: taskViewSchema.shape.root });

export type TaskView = z.output<typeof taskViewSchema>;
export type TaskDetailView = z.output<typeof taskDetailViewSchema>;

// ---- Inputs ----

export const taskListQuerySchema = z.strictObject({
  edition_id: id.optional(),
  status: z.enum(TASK_STATUS_FILTERS).optional(),
  category: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/).optional(),
  blocking_level: z.enum(TASK_BLOCKING_LEVELS).optional(),
  assigned: z.enum(["me", "unassigned"]).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type TaskListQuery = z.output<typeof taskListQuerySchema>;

const reasonSchema = z.string().trim().min(1).max(500);
/** resolve / waive: a reason is mandatory. */
export const taskCloseBodySchema = z.strictObject({ reason: reasonSchema });
/** assign: a staff member (who must see the task's Edition), a role, both, or neither to clear the assignment. */
export const taskAssignBodySchema = z.strictObject({
  assignee_id: id.nullable().optional(),
  assigned_role: z.enum(TASK_ASSIGNED_ROLES).nullable().optional(),
});
export const taskRefreshBodySchema = z.strictObject({ edition_id: id });
