import { describe, expect, test } from "vitest";
import { platformSettingsSchema } from "@/lib/server/domain/events/contracts";
import { routeRevisionSchema } from "@/lib/server/domain/routes/contracts";
import { administrativeClosureSchema, attendanceFinalizationSchema, attendanceResolutionSchema, sportingEligibilitySchema } from "@/lib/shared/closure";

// P3-P: the actor labels are additive. Responses from before the label (older fixtures, replayed idempotency records) keep parsing, and the new keys
// parse when present. Behaviour (who sees what) lives in supabase/tests/database/760 and tests/integration/events/followups-media-publish-actor-labels.test.ts.

const guid = "7f0c1a52-3b6e-4c1d-9a55-0b9f4d6a1e10";
const at = "2026-10-03T12:00:00+00:00";

const resolution = {
  attendance_resolution_id: guid,
  registration_id: guid,
  revision: 1,
  status: "PRESENT",
  source: "MANUAL",
  checkin_id: null,
  reason: null,
  evidence_metadata: {},
  resolved_by_staff_id: guid,
  resolved_at: at,
};
const eligibility = {
  sporting_eligibility_resolution_id: guid,
  registration_id: guid,
  revision: 1,
  status: "ELIGIBLE",
  distance_credit_disposition: "ALLOW",
  reason_code: null,
  reason: null,
  resolved_by_staff_id: guid,
  resolved_at: at,
};
const finalization = {
  attendance_finalization_id: guid,
  edition_id: guid,
  revision: 1,
  status: "FINALIZED",
  expected_count: 1,
  present_count: 1,
  no_show_count: 0,
  excluded_count: 0,
  finalized_by_staff_id: guid,
  finalized_at: at,
};
const closure = { administrative_closure_id: guid, edition_id: guid, revision: 1, attendance_finalization_id: guid, status: "CLOSED", closed_by_staff_id: guid, closed_at: at };
const settings = {
  timezone: "America/Monterrey",
  default_whatsapp_phone_e164: null,
  registration_hold_minutes: 20,
  registration_close_offset_minutes: 0,
  email_otp_expiry_seconds: 600,
  availability_low_threshold_percent: null,
  updated_at: null,
  updated_by_staff_id: null,
};

describe("staff-safe actor labels are additive (P3-AC-09, P3-AC-11)", () => {
  test.each([
    ["attendance resolution", attendanceResolutionSchema, resolution, "resolved_by_staff_label"],
    ["sporting eligibility", sportingEligibilitySchema, eligibility, "resolved_by_staff_label"],
    ["attendance finalization", attendanceFinalizationSchema, finalization, "finalized_by_staff_label"],
    ["administrative closure", administrativeClosureSchema, closure, "closed_by_staff_label"],
    ["platform settings", platformSettingsSchema, settings, "updated_by_staff_label"],
  ] as const)("%s parses with and without its label", (_name, schema, base, field) => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.parse({ ...base, [field]: "Ana L." })).toMatchObject({ [field]: "Ana L." });
    expect(schema.parse({ ...base, [field]: "Staff #abc123" })).toMatchObject({ [field]: "Staff #abc123" });
    // The unknown-key guard of the strict objects still applies to everything else.
    expect(schema.safeParse({ ...base, [field]: "Ana L.", email: "a@b.c" }).success).toBe(false);
  });

  test("a label may be null where the actor can be absent (platform settings, resolutions)", () => {
    expect(platformSettingsSchema.parse({ ...settings, updated_by_staff_label: null }).updated_by_staff_label).toBeNull();
    expect(attendanceResolutionSchema.parse({ ...resolution, resolved_by_staff_id: null, resolved_by_staff_label: null }).resolved_by_staff_label).toBeNull();
  });

  test("route revision parses with and without created_by_staff_label (never null: the creator always exists)", () => {
    const revision = {
      route_revision_id: guid,
      route_id: guid,
      edition_id: guid,
      revision: 1,
      status: "DRAFT",
      source: "MANUAL",
      source_filename: null,
      geometry: { type: "LineString", coordinates: [[-100.3, 25.6], [-100.2, 25.7]] },
      computed_distance_m: 1000,
      validation_result: {},
      pois: [],
      created_by_staff_id: guid,
      created_at: at,
      published_at: null,
      superseded_at: null,
    };
    expect(routeRevisionSchema.safeParse(revision).success).toBe(true);
    expect(routeRevisionSchema.parse({ ...revision, created_by_staff_label: "Staff #abc123" }).created_by_staff_label).toBe("Staff #abc123");
    expect(routeRevisionSchema.safeParse({ ...revision, created_by_staff_label: null }).success).toBe(false);
  });
});
