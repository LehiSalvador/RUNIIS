import { describe, expect, it } from "vitest";
import {
  checkInScanBodySchema,
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
