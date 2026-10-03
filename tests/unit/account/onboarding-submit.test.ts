import { describe, expect, test } from "vitest";
import { onboardingAlreadyCompleted, onboardingLegalVersionIds } from "@/components/account/onboarding-form";
import { toApiResult } from "@/lib/client/api";

// P2-G5 / P2-G6: the onboarding form always sends legal_document_version_ids and treats "already READY" as done.
const TERMS = { legal_document_version_id: "70000000-0000-4000-8000-000000000001" };
const PRIVACY = { legal_document_version_id: "70000000-0000-4000-8000-000000000002" };

describe("onboarding legal_document_version_ids (always sent)", () => {
  test("lists every current version the person was shown", () => {
    expect(onboardingLegalVersionIds([TERMS, PRIVACY])).toEqual([TERMS.legal_document_version_id, PRIVACY.legal_document_version_id]);
  });

  test("is an empty array, never undefined, when no TERMS/PRIVACY version is published", () => {
    const ids = onboardingLegalVersionIds([]);
    expect(ids).toEqual([]);
    expect(Array.isArray(ids)).toBe(true);
    // The body the form builds keeps the key even when the list is empty (JSON.stringify drops undefined, not []).
    expect(JSON.parse(JSON.stringify({ full_name: "x", legal_document_version_ids: ids }))).toHaveProperty("legal_document_version_ids", []);
  });
});

describe("onboarding re-post after READY", () => {
  const conflict = toApiResult(409, { error: { code: "CONFLICT", message: "", details: { reason: "PROFILE_ALREADY_READY" } } });

  test("409 CONFLICT PROFILE_ALREADY_READY counts as completed (route on, no error banner)", () => {
    expect(conflict).toMatchObject({ ok: false, status: 409, code: "CONFLICT" });
    expect(onboardingAlreadyCompleted(conflict)).toBe(true);
  });

  test("a success counts as completed too", () => {
    expect(onboardingAlreadyCompleted(toApiResult(200, { data: {} }))).toBe(true);
  });

  test("real failures do not: legal acceptance, validation, rate limit, network", () => {
    for (const [status, code] of [[400, "LEGAL_ACCEPTANCE_REQUIRED"], [400, "VALIDATION_FAILED"], [429, "RATE_LIMITED"], [500, "INTERNAL_ERROR"]] as const) {
      expect(onboardingAlreadyCompleted(toApiResult(status, { error: { code, message: "", details: {} } })), code).toBe(false);
    }
    expect(onboardingAlreadyCompleted(toApiResult(0, null))).toBe(false);
  });
});
