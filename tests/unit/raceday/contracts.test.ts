import { describe, expect, it } from "vitest";
import {
  checkInScanBodySchema,
  guardianVerificationListItemSchema,
  participantMinimalSchema,
  participantSearchItemSchema,
  scannerEditionListSchema,
  kitAllocationSizeBodySchema,
  kitPickupBodySchema,
  participantSearchQuerySchema,
  scanOutcomeSchema,
} from "@/lib/server/domain/raceday/contracts";

const EDITION_ID = "11111111-1111-4111-8111-111111111111";
const KIT_DEFINITION_ID = "22222222-2222-4222-8222-222222222222";
const REGISTRATION_ID = "33333333-3333-4333-8333-333333333333";

describe("raceday contracts: request-body validation (invalid input -> VALIDATION_ERROR, never a 500)", () => {
  it("scanOutcomeSchema covers exactly the Master §85 outcome vocabulary", () => {
    expect(scanOutcomeSchema.options.sort()).toEqual(
      [
        "VALID",
        "ALREADY_CHECKED_IN",
        "REVOKED_CREDENTIAL",
        "REPLACED_CREDENTIAL",
        "WRONG_EVENT",
        "REGISTRATION_NOT_CONFIRMED",
        "GUARDIAN_VERIFICATION_REQUIRED",
        "UNKNOWN_PASS",
        "CANCELED_REGISTRATION",
        "NOT_YET_ALLOWED",
        "OTHER_REVIEW",
      ].sort(),
    );
  });

  it("checkInScanBodySchema accepts a well-formed body and rejects a non-UUID edition_id", () => {
    expect(checkInScanBodySchema.safeParse({ edition_id: EDITION_ID, credential_token: "RN1.abc", station_key: "S1" }).success).toBe(true);
    expect(checkInScanBodySchema.safeParse({ edition_id: "not-a-uuid", credential_token: "RN1.abc" }).success).toBe(false);
  });

  it("checkInScanBodySchema rejects unknown fields (strict object)", () => {
    const result = checkInScanBodySchema.safeParse({ edition_id: EDITION_ID, credential_token: "RN1.abc", extra: "nope" });
    expect(result.success).toBe(false);
  });

  it("kitPickupBodySchema requires exactly one of credential_token or registration_id", () => {
    const base = { edition_id: EDITION_ID, kit_definition_id: KIT_DEFINITION_ID };
    expect(kitPickupBodySchema.safeParse({ ...base }).success).toBe(false); // neither
    expect(kitPickupBodySchema.safeParse({ ...base, credential_token: "RN1.abc", registration_id: REGISTRATION_ID }).success).toBe(false); // both
    expect(kitPickupBodySchema.safeParse({ ...base, credential_token: "RN1.abc" }).success).toBe(true);
    expect(kitPickupBodySchema.safeParse({ ...base, registration_id: REGISTRATION_ID }).success).toBe(true);
  });

  it("kitAllocationSizeBodySchema rejects an empty reason", () => {
    expect(kitAllocationSizeBodySchema.safeParse({ new_kit_variant_id: KIT_DEFINITION_ID, reason: "" }).success).toBe(false);
    expect(kitAllocationSizeBodySchema.safeParse({ new_kit_variant_id: KIT_DEFINITION_ID, reason: "talla incorrecta" }).success).toBe(true);
  });

  it("participantSearchQuerySchema rejects an empty query (SEC-024's >=3 rule is re-checked, and detailed, by the DB)", () => {
    expect(participantSearchQuerySchema.safeParse({ q: "" }).success).toBe(false);
    expect(participantSearchQuerySchema.safeParse({ q: "ab" }).success).toBe(true);
  });
});

const MODALITY = { modality_id: KIT_DEFINITION_ID, name: "10K" };
const participant = {
  registration_id: REGISTRATION_ID,
  registration_number: "RN-1",
  registration_status: "CONFIRMED",
  participant_kind: "GUEST" as const,
  display_name: "Menor",
  avatar_object_key: null,
  modality: MODALITY,
  category: null,
  is_minor: true,
  guardian_state: "PENDING" as const,
  guardian: { display_name: "Tutor", relationship_type: "PARENT" },
};

describe("P3-Q contracts: guardian identity, final REJECTED rows, kit ids and the scanner Edition list", () => {
  it("participantMinimalSchema carries the guardian block (name + relationship only) or null", () => {
    expect(participantMinimalSchema.safeParse(participant).success).toBe(true);
    expect(participantMinimalSchema.safeParse({ ...participant, guardian: null, guardian_state: null, is_minor: false }).success).toBe(true);
    // Strict: a guardian email, phone or date of birth can never ride along.
    expect(participantMinimalSchema.safeParse({ ...participant, guardian: { ...participant.guardian, email: "a@b.c" } }).success).toBe(false);
    expect(participantMinimalSchema.safeParse({ ...participant, guardian: { ...participant.guardian, phone_e164: "+520000000000" } }).success).toBe(false);
    expect(participantMinimalSchema.safeParse({ ...participant, guardian: { display_name: "Tutor" } }).success).toBe(false);
  });

  it("guardianVerificationListItemSchema models a final REJECTED row (is_final, no actions) beside an actionable PENDING one", () => {
    const base = { guardian_event_verification_id: REGISTRATION_ID, created_at: "2026-10-10T10:00:00Z", participant };
    expect(guardianVerificationListItemSchema.safeParse({ ...base, status: "PENDING", is_final: false, actions: ["VERIFY", "REJECT"] }).success).toBe(true);
    expect(guardianVerificationListItemSchema.safeParse({ ...base, status: "REJECTED", is_final: true, actions: [] }).success).toBe(true);
    expect(guardianVerificationListItemSchema.safeParse({ ...base, status: "REJECTED", is_final: true, actions: ["REOPEN"] }).success).toBe(false);
  });

  it("participantSearchItemSchema carries public_code and the kit ids the kit desk needs", () => {
    const item = {
      registration_id: REGISTRATION_ID,
      participant_pass_id: null,
      public_code: null,
      registration_number: "RN-1",
      display_name: null,
      modality: MODALITY,
      guardian_state: null,
      kit: null,
    };
    expect(participantSearchItemSchema.safeParse(item).success).toBe(true);
    const kit = { kit_allocation_id: EDITION_ID, kit_definition_id: KIT_DEFINITION_ID, kit_variant_id: REGISTRATION_ID, variant_label: "M", status: "DELIVERED", kit_pickup_id: EDITION_ID };
    expect(participantSearchItemSchema.safeParse({ ...item, public_code: "P-AB12-CD34", kit }).success).toBe(true);
    expect(participantSearchItemSchema.safeParse({ ...item, kit: { ...kit, kit_pickup_id: null } }).success).toBe(true);
    expect(participantSearchItemSchema.safeParse({ ...item, kit: { ...kit, kit_allocation_id: "x" } }).success).toBe(false);
  });

  it("scannerEditionListSchema is strict about the Edition fields it exposes", () => {
    const edition = { edition_id: EDITION_ID, name: "Edicion", event_name: "Evento", date: null, timezone: "America/Monterrey", state: "SCHEDULED", publication_state: "PUBLISHED" };
    expect(scannerEditionListSchema.safeParse({ items: [edition, { ...edition, date: "2026-10-11" }] }).success).toBe(true);
    expect(scannerEditionListSchema.safeParse({ items: [{ ...edition, slug: "extra" }] }).success).toBe(false);
  });
});
