import { describe, expect, test } from "vitest";
import {
  adminEventListQuerySchema,
  adminEventListSchema,
  adminEventSchema,
  antiHoardingPolicySchema,
  cancelEditionBodySchema,
  finishEditionBodySchema,
  hideEditionBodySchema,
  openRegistrationBodySchema,
  pauseRegistrationBodySchema,
  postponeEditionBodySchema,
  publishEditionBodySchema,
  rescheduleEditionBodySchema,
  resumeRegistrationBodySchema,
  setEditionScheduleBodySchema,
  startEditionBodySchema,
  closeRegistrationBodySchema,
  updateAntiHoardingPolicyBodySchema,
  updateEditionBodySchema,
} from "@/lib/server/domain/events/contracts";

// P3-L contract tests: the optional optimistic-concurrency token on every Edition edit/transition body, the Events catalogue/read
// schemas and the anti-hoarding policy body. Behaviour against the database lives in supabase/tests/database/730 and
// tests/integration/events/admin-api-gaps.test.ts.

const token = "2026-10-03T12:34:56.123456+00:00";
const guid = "7f0c1a52-3b6e-4c1d-9a55-0b9f4d6a1e10";

describe("expected_updated_at precondition (P3-AC-15)", () => {
  const transitions: [string, { parse: (v: unknown) => unknown }, Record<string, unknown>][] = [
    ["publish", publishEditionBodySchema, {}],
    ["hide", hideEditionBodySchema, { reason: "x" }],
    ["open-registration", openRegistrationBodySchema, {}],
    ["pause-registration", pauseRegistrationBodySchema, { reason: "x" }],
    ["resume-registration", resumeRegistrationBodySchema, {}],
    ["close-registration", closeRegistrationBodySchema, { reason: "x" }],
    ["postpone", postponeEditionBodySchema, { reason: "x" }],
    ["reschedule", rescheduleEditionBodySchema, { reason: "x", local_date: "2027-01-01" }],
    ["cancel", cancelEditionBodySchema, { reason: "x" }],
    ["start", startEditionBodySchema, {}],
    ["finish", finishEditionBodySchema, {}],
    ["schedule", setEditionScheduleBodySchema, { local_date: "2027-01-01" }],
    ["update", updateEditionBodySchema, { name: "x" }],
  ];

  test.each(transitions)("%s accepts the token and keeps working without it", (_name, schema, base) => {
    expect(schema.parse(base)).toEqual(base);
    expect(schema.parse({ ...base, expected_updated_at: token })).toEqual({ ...base, expected_updated_at: token });
  });

  test.each(transitions)("%s rejects a malformed token and still rejects unknown fields", (_name, schema, base) => {
    expect(() => schema.parse({ ...base, expected_updated_at: "yesterday" })).toThrow();
    expect(() => schema.parse({ ...base, expected_updated_at: 1700000000 })).toThrow();
    expect(() => schema.parse({ ...base, unknown_field: 1 })).toThrow();
  });

  test("the token is passed through verbatim (no Date round trip that would drop microseconds)", () => {
    expect((updateEditionBodySchema.parse({ expected_updated_at: token }) as { expected_updated_at: string }).expected_updated_at).toBe(token);
  });
});

describe("Events catalogue contracts", () => {
  const event = {
    event_id: guid,
    name: "Carrera",
    canonical_key: "carrera",
    status: "ACTIVE",
    event_type_key: "ROAD_RACE",
    event_type_name: "Carrera",
    created_at: token,
    updated_at: token,
  };

  test("list item carries the edition count and is strict", () => {
    const item = { ...event, edition_count: 0, latest_edition_created_at: null };
    expect(adminEventListSchema.parse({ items: [item], next_cursor: null }).items[0]?.edition_count).toBe(0);
    expect(() => adminEventListSchema.parse({ items: [{ ...item, extra: 1 }], next_cursor: null })).toThrow();
    expect(() => adminEventListSchema.parse({ items: [{ ...event }], next_cursor: null })).toThrow();
  });

  test("read projection carries the Edition summary with its version", () => {
    const edition = {
      edition_id: guid,
      slug: "s",
      name: "n",
      publication_state: "DRAFT",
      registration_state: "NOT_OPEN",
      execution_state: "SCHEDULED",
      sport_date: null,
      created_at: token,
      updated_at: token,
    };
    expect(adminEventSchema.parse({ ...event, edition_count: 1, editions: [edition] }).editions[0]?.updated_at).toBe(token);
    expect(() => adminEventSchema.parse({ ...event, edition_count: 1, editions: [{ ...edition, publication_state: "NOPE" }] })).toThrow();
  });

  test("query: filters are validated, unknown params are refused (so the Editions query cannot leak in)", () => {
    expect(adminEventListQuerySchema.parse({ status: "ARCHIVED", limit: "5" })).toEqual({ status: "ARCHIVED", limit: 5 });
    expect(() => adminEventListQuerySchema.parse({ status: "DELETED" })).toThrow();
    expect(() => adminEventListQuerySchema.parse({ publication_state: "DRAFT" })).toThrow();
    expect(() => adminEventListQuerySchema.parse({ limit: "101" })).toThrow();
  });
});

describe("anti-hoarding policy contracts (P3-AC-13)", () => {
  test("projection mirrors the RPC result", () => {
    const policy = {
      captcha_new_account_hours: 24,
      large_hold_min_places: 5,
      new_account_hold_share_percent: 10,
      new_account_hold_min_places: 10,
      single_buyer_hold_places: 10,
      updated_at: token,
    };
    expect(antiHoardingPolicySchema.parse(policy)).toEqual(policy);
    expect(() => antiHoardingPolicySchema.parse({ ...policy, extra: 1 })).toThrow();
  });

  test("body: partial updates, ranges mirror the SQL validators, at least one field, nothing unknown", () => {
    expect(updateAntiHoardingPolicyBodySchema.parse({ captcha_new_account_hours: 48 })).toEqual({ captcha_new_account_hours: 48 });
    expect(updateAntiHoardingPolicyBodySchema.parse({ new_account_hold_share_percent: 12.5 })).toEqual({ new_account_hold_share_percent: 12.5 });
    expect(() => updateAntiHoardingPolicyBodySchema.parse({})).toThrow();
    expect(() => updateAntiHoardingPolicyBodySchema.parse({ captcha_new_account_hours: 0 })).toThrow();
    expect(() => updateAntiHoardingPolicyBodySchema.parse({ captcha_new_account_hours: 169 })).toThrow();
    expect(() => updateAntiHoardingPolicyBodySchema.parse({ large_hold_min_places: 1 })).toThrow();
    expect(() => updateAntiHoardingPolicyBodySchema.parse({ single_buyer_hold_places: 21 })).toThrow();
    expect(() => updateAntiHoardingPolicyBodySchema.parse({ new_account_hold_share_percent: 100.5 })).toThrow();
    expect(() => updateAntiHoardingPolicyBodySchema.parse({ captcha_new_account_hours: 1.5 })).toThrow();
    expect(() => updateAntiHoardingPolicyBodySchema.parse({ nope: 1 })).toThrow();
  });
});
