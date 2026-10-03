import { describe, expect, it } from "vitest";
import { onboardingSchema } from "@/lib/server/domain/auth/contracts";

// H2P2-05 (OWN-05 "acceptance never implied"): the onboarding body must carry the legal version ids the user was shown.

const VERSION_ID = "69000000-0000-4000-8000-000000000001";

const base = {
  full_name: "Persona Contrato",
  date_of_birth: "1990-05-05",
  sex_code: "F",
  phone_e164: "+528110000900",
  emergency_contact_name: "Contacto Emergencia",
  emergency_contact_phone_e164: "+528110000901",
  emergency_contact_relationship: "Madre",
} as const;

describe("onboardingSchema legal_document_version_ids", () => {
  it("rejects a body that omits the ids", () => {
    const result = onboardingSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === "legal_document_version_ids")).toBe(true);
  });

  it("rejects null and non-uuid entries", () => {
    expect(onboardingSchema.safeParse({ ...base, legal_document_version_ids: null }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...base, legal_document_version_ids: ["not-a-uuid"] }).success).toBe(false);
  });

  it("accepts the ids the client displayed", () => {
    const result = onboardingSchema.safeParse({ ...base, legal_document_version_ids: [VERSION_ID] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.legal_document_version_ids).toEqual([VERSION_ID]);
  });

  it("accepts an explicit empty list (valid only while nothing is published; the database decides)", () => {
    expect(onboardingSchema.safeParse({ ...base, legal_document_version_ids: [] }).success).toBe(true);
  });
});
