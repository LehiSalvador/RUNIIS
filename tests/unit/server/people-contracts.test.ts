import { describe, expect, test } from "vitest";
import {
  friendshipCreateSchema,
  guardianCreateSchema,
  guestFieldsSchema,
  guestPatchSchema,
  peopleSearchQuerySchema,
} from "@/lib/server/domain/people/contracts";

// Contract-level tests for the people domain's zod boundary (SEC-016/120): unknown fields, ranges
// and formats must fail closed here, before anything reaches the database.

describe("guestFieldsSchema / guestPatchSchema", () => {
  const valid = {
    full_name: "  Invitado   Uno ",
    date_of_birth: "1990-02-02",
    sex_code: "M",
    phone_e164: "+52 811 000 0010",
    emergency_contact_name: "Contacto Uno",
    emergency_contact_phone_e164: "+528110000011",
    emergency_contact_relationship: "Hermano",
  };

  test("cleans whitespace and normalizes phones to E.164", () => {
    const parsed = guestFieldsSchema.parse(valid);
    expect(parsed.full_name).toBe("Invitado Uno");
    expect(parsed.phone_e164).toBe("+528110000010");
  });

  test("rejects an unknown field on create (SEC-016)", () => {
    expect(() => guestFieldsSchema.parse({ ...valid, owner_profile_id: "x" })).toThrow();
  });

  test("rejects a non-E.164 phone", () => {
    expect(() => guestFieldsSchema.parse({ ...valid, phone_e164: "81 1234 5678" })).toThrow();
  });

  test("PATCH rejects an unknown key such as status or archive_after", () => {
    expect(() => guestPatchSchema.parse({ status: "ARCHIVED" })).toThrow();
    expect(() => guestPatchSchema.parse({ archive_after: null })).toThrow();
  });

  test("PATCH rejects an empty patch", () => {
    expect(() => guestPatchSchema.parse({})).toThrow();
  });

  test("PATCH accepts a partial, allowlisted update", () => {
    const parsed = guestPatchSchema.parse({ phone_e164: "+528110000099" });
    expect(parsed).toEqual({ phone_e164: "+528110000099" });
  });
});

describe("peopleSearchQuerySchema", () => {
  test("rejects a query shorter than 2 normalised characters", () => {
    expect(() => peopleSearchQuerySchema.parse({ q: " a " })).toThrow();
  });

  test("rejects an unknown query param", () => {
    expect(() => peopleSearchQuerySchema.parse({ q: "ana", include_minors: "true" })).toThrow();
  });

  test("accepts a bare query with no cursor", () => {
    expect(peopleSearchQuerySchema.parse({ q: "ana" })).toEqual({ q: "ana" });
  });
});

describe("friendshipCreateSchema", () => {
  test("requires a UUID public_profile_id and rejects extra fields", () => {
    expect(() => friendshipCreateSchema.parse({ public_profile_id: "not-a-uuid" })).toThrow();
    expect(() =>
      friendshipCreateSchema.parse({ public_profile_id: "10000000-0000-4000-8000-000000000001", note: "hi" }),
    ).toThrow();
  });
});

describe("guardianCreateSchema", () => {
  test("RUNNER branch requires counterpart_public_profile_id, not guest_participant_id", () => {
    expect(() =>
      guardianCreateSchema.parse({
        minor_kind: "RUNNER",
        guest_participant_id: "10000000-0000-4000-8000-000000000001",
        relationship_type: "PARENT",
      }),
    ).toThrow();
  });

  test("GUEST branch accepts an omitted guardian_public_profile_id (self as guardian)", () => {
    const parsed = guardianCreateSchema.parse({
      minor_kind: "GUEST",
      guest_participant_id: "10000000-0000-4000-8000-000000000001",
      relationship_type: "LEGAL_GUARDIAN",
    });
    expect(parsed.minor_kind).toBe("GUEST");
    expect("guardian_public_profile_id" in parsed ? parsed.guardian_public_profile_id : undefined).toBeUndefined();
  });

  test("rejects an unknown relationship_type", () => {
    expect(() =>
      guardianCreateSchema.parse({
        minor_kind: "GUEST",
        guest_participant_id: "10000000-0000-4000-8000-000000000001",
        relationship_type: "UNCLE",
      }),
    ).toThrow();
  });
});
