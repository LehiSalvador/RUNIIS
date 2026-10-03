import { describe, expect, test } from "vitest";
import {
  TASK_SOURCE_RULES,
  taskAssignBodySchema,
  taskCloseBodySchema,
  taskListPageSchema,
  taskListQuerySchema,
  taskRoot,
  taskSchema,
} from "@/lib/shared/tasks";
import { BULK_CANCEL_MAX_REQUESTS, bulkCancelRequestsBodySchema, bulkCancelResultSchema, createRegistrationRequestBodySchema } from "@/lib/shared/registration";

// P3-D contracts: Task Center projection (strict mirror of the SQL jsonb), root link hints, bulk cancel input/output, challenge parameter.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = {
  admin_task_id: id(1),
  task_key: `attendance-finalization:${id(2)}`,
  category: "ATTENDANCE",
  scope_type: "EDITION",
  scope_id: id(2),
  edition_id: id(2),
  related_entity_type: "edition",
  related_entity_id: id(2),
  title: "t",
  description: "d",
  priority: "HIGH",
  blocking_level: "CLOSURE_BLOCKER",
  status: "OPEN",
  assigned_role: null,
  assigned_staff_id: null,
  detected_at: "2026-10-05T10:00:00+00:00",
  due_at: null,
  started_at: null,
  resolved_at: null,
  resolution_type: null,
  resolution_reason: null,
  source_rule: "attendance-finalization",
  metadata: { active: true },
  created_at: "2026-10-05T10:00:00+00:00",
  updated_at: "2026-10-05T10:00:00+00:00",
};

describe("task projection contract", () => {
  test("accepts the SQL projection and fails closed on an unexpected key or value", () => {
    expect(taskSchema.safeParse(task).success).toBe(true);
    expect(taskSchema.safeParse({ ...task, extra: 1 }).success).toBe(false);
    expect(taskSchema.safeParse({ ...task, status: "DONE" }).success).toBe(false);
    expect(taskSchema.safeParse({ ...task, blocking_level: "NOPE" }).success).toBe(false);
  });

  test("list page: partial counts and a nullable cursor", () => {
    const page = { items: [task], counts: { by_status: { OPEN: 1 }, active_by_blocking_level: { CLOSURE_BLOCKER: 1 } }, next_cursor: null };
    expect(taskListPageSchema.safeParse(page).success).toBe(true);
    expect(taskListPageSchema.safeParse({ ...page, next_cursor: { rank: 4, detected_at: "x", id: id(1) } }).success).toBe(true);
    expect(taskListPageSchema.safeParse({ ...page, counts: { by_status: { BOGUS: 1 }, active_by_blocking_level: {} } }).success).toBe(false);
  });

  test("every writer rule points to a section and unknown rules fall back to the Edition or the platform", () => {
    for (const rule of TASK_SOURCE_RULES) {
      expect(taskRoot({ source_rule: rule, edition_id: id(2), related_entity_type: null, related_entity_id: null }).section).toBeTruthy();
    }
    expect(taskRoot(task).section).toBe("attendance");
    expect(taskRoot({ ...task, source_rule: "closure-pending" }).section).toBe("closure");
    expect(taskRoot({ ...task, source_rule: "closure-integrity", related_entity_type: "community_integrity_case", related_entity_id: id(9) })).toEqual({
      section: "integrity",
      edition_id: id(2),
      entity_type: "community_integrity_case",
      entity_id: id(9),
    });
    expect(taskRoot({ ...task, source_rule: "provider-reconciliation", edition_id: null }).section).toBe("communications");
    expect(taskRoot({ ...task, source_rule: "hold-concentration" }).section).toBe("registration-requests");
    expect(taskRoot({ ...task, source_rule: "something-new" }).section).toBe("edition");
    expect(taskRoot({ ...task, source_rule: "something-new", edition_id: null }).section).toBe("platform");
  });
});

describe("task inputs", () => {
  test("list query is strict, bounded and coerces limit", () => {
    expect(taskListQuerySchema.parse({ status: "ALL", assigned: "me", limit: "50" })).toMatchObject({ status: "ALL", assigned: "me", limit: 50 });
    expect(taskListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ status: "nope" }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ category: "lower" }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ unknown: "x" }).success).toBe(false);
  });

  test("resolve/waive need a trimmed reason of at most 500 characters; assign accepts nulls", () => {
    expect(taskCloseBodySchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(taskCloseBodySchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(taskCloseBodySchema.parse({ reason: "  ok  " }).reason).toBe("ok");
    expect(taskAssignBodySchema.safeParse({ assignee_id: null, assigned_role: null }).success).toBe(true);
    expect(taskAssignBodySchema.safeParse({ assigned_role: "JANITOR" }).success).toBe(false);
  });
});

describe("bulk cancel and challenge parameter contracts", () => {
  test("bulk body: 1..100 unique ids and a reason", () => {
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: [id(1)], reason: "r" }).success).toBe(true);
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: [], reason: "r" }).success).toBe(false);
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: [id(1), id(1)], reason: "r" }).success).toBe(false);
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: Array.from({ length: BULK_CANCEL_MAX_REQUESTS + 1 }, (_, i) => id(i + 1)), reason: "r" }).success).toBe(false);
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: [id(1)], reason: "" }).success).toBe(false);
    expect(bulkCancelRequestsBodySchema.safeParse({ request_ids: [id(1)], reason: "r", extra: 1 }).success).toBe(false);
  });

  test("bulk result mirrors the SQL (per-id outcome rows) and fails closed", () => {
    const result = {
      edition_id: id(2),
      correlation_id: id(3),
      requested_count: 2,
      canceled_count: 1,
      already_canceled_count: 0,
      rejected_count: 1,
      failed_count: 0,
      results: [
        { registration_request_id: id(1), outcome: "CANCELED", status: "CANCELED_BY_STAFF" },
        { registration_request_id: id(4), outcome: "NOT_FOUND" },
      ],
    };
    expect(bulkCancelResultSchema.safeParse(result).success).toBe(true);
    expect(bulkCancelResultSchema.safeParse({ ...result, results: [{ registration_request_id: id(1), outcome: "WEIRD" }] }).success).toBe(false);
  });

  test("the create body accepts an optional altcha payload and nothing else new", () => {
    const base = { edition_id: "50000000-0000-4000-8000-000000000001", participants: [{ kind: "PROFILE", public_profile_id: "c0000000-0000-4000-8000-000000000001", modality_id: "60000000-0000-4000-8000-000000000001" }] };
    expect(createRegistrationRequestBodySchema.safeParse(base).success).toBe(true);
    expect(createRegistrationRequestBodySchema.safeParse({ ...base, altcha: "eyJ9" }).success).toBe(true);
    expect(createRegistrationRequestBodySchema.safeParse({ ...base, altcha: "" }).success).toBe(false);
    expect(createRegistrationRequestBodySchema.safeParse({ ...base, altcha: "x".repeat(2001) }).success).toBe(false);
    expect(createRegistrationRequestBodySchema.safeParse({ ...base, captcha: "x" }).success).toBe(false);
  });
});
