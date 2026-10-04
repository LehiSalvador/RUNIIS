import { describe, expect, test } from "vitest";
import {
  mediaAssetIdParamSchema,
  mediaAssetTransitionBodySchema,
  scheduleRevisionHistorySchema,
  updateMediaAssetBodySchema,
} from "@/lib/server/domain/events/contracts";
import { taskSchema } from "@/lib/shared/tasks";

// P3-O contract tests: media lifecycle bodies (strict, token required, status not editable here) and the staff-safe label on the two reads that carry an
// actor. Behaviour against the database lives in supabase/tests/database/750 and tests/integration/events/media-lifecycle-staff-labels.test.ts.

const guid = "7f0c1a52-3b6e-4c1d-9a55-0b9f4d6a1e10";
const token = "2026-10-03T12:00:00.123456+00:00";

describe("media asset update body (P3-AC-06)", () => {
  test("names only what changes; focal_point null clears it", () => {
    expect(updateMediaAssetBodySchema.parse({ expected_updated_at: token, alt_text: "  Podio  " })).toEqual({ expected_updated_at: token, alt_text: "Podio" });
    expect(updateMediaAssetBodySchema.parse({ expected_updated_at: token, focal_point: null }).focal_point).toBeNull();
    expect(updateMediaAssetBodySchema.parse({ expected_updated_at: token, sort_order: 0, focal_point: { x: 0, y: 1 } })).toMatchObject({ sort_order: 0 });
  });

  test("the version token is required and must be a timestamp with an offset", () => {
    expect(updateMediaAssetBodySchema.safeParse({ alt_text: "x" }).success).toBe(false);
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: "yesterday", alt_text: "x" }).success).toBe(false);
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: "2026-10-03T12:00:00", alt_text: "x" }).success).toBe(false);
  });

  test("a body with a token and nothing to change is refused", () => {
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token }).success).toBe(false);
  });

  test("status and unknown fields are not accepted (publish / archive are their own commands)", () => {
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, status: "PUBLISHED" }).success).toBe(false);
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, alt_text: "x", edition_id: guid }).success).toBe(false);
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, media_type: "IMAGE" }).success).toBe(false);
  });

  test("alt text cannot be empty or null and the focal point stays inside 0..1", () => {
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, alt_text: "   " }).success).toBe(false);
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, alt_text: null }).success).toBe(false);
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, focal_point: { x: 2, y: 0 } }).success).toBe(false);
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, sort_order: 10001 }).success).toBe(false);
  });

  test("a corrected storage key must be a plain key: no scheme, host or .. segment", () => {
    expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, storage_object_key: "runiis/2027/start-line" }).success).toBe(true);
    for (const key of ["https://res.cloudinary.com/x/a.png", "a/../b", "/abs", ""]) {
      expect(updateMediaAssetBodySchema.safeParse({ expected_updated_at: token, storage_object_key: key }).success).toBe(false);
    }
  });
});

describe("media asset transitions and params", () => {
  test("publish and archive take only the version token", () => {
    expect(mediaAssetTransitionBodySchema.parse({ expected_updated_at: token })).toEqual({ expected_updated_at: token });
    expect(mediaAssetTransitionBodySchema.safeParse({}).success).toBe(false);
    expect(mediaAssetTransitionBodySchema.safeParse({ expected_updated_at: token, status: "ARCHIVED" }).success).toBe(false);
  });

  test("the asset id param is a guid", () => {
    expect(mediaAssetIdParamSchema.parse({ assetId: guid })).toEqual({ assetId: guid });
    expect(mediaAssetIdParamSchema.safeParse({ assetId: "not-a-guid" }).success).toBe(false);
    expect(mediaAssetIdParamSchema.safeParse({ assetId: guid, extra: 1 }).success).toBe(false);
  });
});

describe("staff-safe actor labels (P3-AC-09, P3-AC-12)", () => {
  const revision = {
    edition_schedule_revision_id: guid,
    revision: 1,
    schedule_state: "DATE_TIME_CONFIRMED",
    local_date: "2027-01-10",
    local_start_time: "07:00:00",
    local_end_time: null,
    timezone: "America/Monterrey",
    effective_start_at: "2027-01-10T13:00:00+00:00",
    effective_end_at: null,
    reason: null,
    created_at: token,
    superseded_at: null,
    is_current: true,
    created_by_staff_id: guid,
    created_by_staff_label: "Ana G.",
  };

  test("the revision history requires the label and still fails closed on an email or auth id", () => {
    const page = { items: [revision], total: 1, next_cursor: null };
    expect(scheduleRevisionHistorySchema.parse(page)).toEqual(page);
    const { created_by_staff_label: _label, ...without } = revision;
    expect(scheduleRevisionHistorySchema.safeParse({ items: [without], total: 1, next_cursor: null }).success).toBe(false);
    expect(scheduleRevisionHistorySchema.safeParse({ items: [{ ...revision, staff_email: "x@y.z" }], total: 1, next_cursor: null }).success).toBe(false);
    expect(scheduleRevisionHistorySchema.safeParse({ items: [{ ...revision, created_by_auth_user_id: guid }], total: 1, next_cursor: null }).success).toBe(false);
  });

  test("the task projection accepts the assignee label (null while unassigned) and stays strict", () => {
    const task = {
      admin_task_id: guid,
      task_key: "k",
      category: "RACE_DAY",
      scope_type: "EDITION",
      scope_id: guid,
      edition_id: guid,
      related_entity_type: null,
      related_entity_id: null,
      title: "t",
      description: "d",
      priority: "HIGH",
      blocking_level: "ACTION_REQUIRED",
      status: "IN_PROGRESS",
      assigned_role: null,
      assigned_staff_id: guid,
      assigned_staff_label: "Staff #7f0c1a",
      detected_at: token,
      due_at: null,
      started_at: token,
      resolved_at: null,
      resolution_type: null,
      resolution_reason: null,
      source_rule: "raceday_unknown_pass_burst",
      metadata: {},
      created_at: token,
      updated_at: token,
    };
    expect(taskSchema.safeParse(task).success).toBe(true);
    expect(taskSchema.safeParse({ ...task, assigned_staff_id: null, assigned_staff_label: null }).success).toBe(true);
    const { assigned_staff_label: _label, ...legacy } = task;
    expect(taskSchema.safeParse(legacy).success).toBe(true);
    expect(taskSchema.safeParse({ ...task, assigned_staff_email: "x@y.z" }).success).toBe(false);
  });
});
