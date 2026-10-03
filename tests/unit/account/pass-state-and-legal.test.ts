import { describe, expect, test } from "vitest";
import { isAccountLegalFailure, legalDocumentsPhrase, legalVersionsKey, pendingLegalDocuments, publicLegalPath, type AccountLegalDocument } from "@/components/account/logic/legal";
import { passState } from "@/components/account/logic/pass-state";
import { requestStages } from "@/components/registration/request-parts";
import { effectiveRequestStatus } from "@/lib/shared/registration";

const pass = (overrides: { status?: string; has_active_credential?: boolean; registration_status?: string } = {}) => ({
  status: overrides.status ?? "ACTIVE",
  has_active_credential: overrides.has_active_credential ?? true,
  registration: { registration_id: "r", registration_number: "I-AAAA-BBBB", status: overrides.registration_status ?? "CONFIRMED", confirmed_at: null },
});

describe("P2-AC-12 passState: what is valid and what never shows a QR", () => {
  test("ACTIVE + CONFIRMED + credential = valid, QR available", () => {
    expect(passState(pass())).toMatchObject({ kind: "VALID", canShowQr: true });
  });
  test("a replaced / not yet issued credential keeps the pass but says the previous QR no longer works", () => {
    const state = passState(pass({ has_active_credential: false }));
    expect(state).toMatchObject({ kind: "RENEWING", canShowQr: true });
    expect(state.message).toMatch(/QR anterior ya no sirve/);
  });
  test.each([
    ["REVOKED", "ACTIVE", "REVOKED", /revocado/i],
    ["CANCELED", "ACTIVE", "CANCELED", /cancelado/i],
  ])("a %s pass is never valid and never offers a QR, whatever its credential says", (status, _registration, kind, copy) => {
    for (const has_active_credential of [true, false]) {
      const state = passState(pass({ status, has_active_credential }));
      expect(state).toMatchObject({ kind, canShowQr: false });
      expect(state.message).toMatch(copy);
    }
  });
  test("an ACTIVE pass whose registration is no longer CONFIRMED is not valid", () => {
    for (const registration_status of ["CANCELED", "PENDING", "VOID"]) {
      expect(passState(pass({ registration_status }))).toMatchObject({ kind: "REGISTRATION_INACTIVE", canShowQr: false });
    }
  });
});

const doc = (overrides: Partial<AccountLegalDocument>): AccountLegalDocument => ({
  document_type: "TERMS_OF_SERVICE",
  document_key: "TERMS_OF_SERVICE",
  legal_document_version_id: "64000000-0000-4000-8000-0000000c0003",
  version: 2,
  published_at: "2026-10-01T00:00:00Z",
  status: "NEW_VERSION",
  accepted_at: null,
  accepted_version: 1,
  ...overrides,
});

describe("P2-AC-02.c account legal helpers (OWN-05)", () => {
  const terms = doc({});
  const privacy = doc({ document_type: "PRIVACY_NOTICE", document_key: "PRIVACY_NOTICE", legal_document_version_id: "64000000-0000-4000-8000-0000000c0004", status: "NEVER_ACCEPTED", accepted_version: null });
  const accepted = doc({ status: "ACCEPTED", accepted_version: 2, legal_document_version_id: "64000000-0000-4000-8000-0000000c0005" });

  test("only documents that are not ACCEPTED are pending (first acceptance or a newer version)", () => {
    expect(pendingLegalDocuments([terms, privacy, accepted]).map((d) => d.document_type)).toEqual(["TERMS_OF_SERVICE", "PRIVACY_NOTICE"]);
    expect(pendingLegalDocuments([accepted])).toEqual([]);
    // The API lists by type name (PRIVACY first); the screen asks for the Terms first.
    expect(pendingLegalDocuments([privacy, terms]).map((d) => d.document_type)).toEqual(["TERMS_OF_SERVICE", "PRIVACY_NOTICE"]);
  });
  test("the tick key changes with the version ids (a newer version cancels a stale tick)", () => {
    const before = legalVersionsKey([terms, privacy]);
    const after = legalVersionsKey([doc({ legal_document_version_id: "64000000-0000-4000-8000-0000000c0009" }), privacy]);
    expect(before).not.toBe(after);
    expect(legalVersionsKey([])).toBe("");
  });
  test("links go to the public legal pages", () => {
    expect(publicLegalPath("TERMS_OF_SERVICE")).toBe("/legal/terminos");
    expect(publicLegalPath("PRIVACY_NOTICE")).toBe("/legal/privacidad");
  });
  test("phrase names the documents", () => {
    expect(legalDocumentsPhrase([terms, privacy])).toBe("los Términos y condiciones y el Aviso de privacidad");
    expect(legalDocumentsPhrase([privacy])).toBe("el Aviso de privacidad");
  });
  test("only LEGAL_ACCEPTANCE_REQUIRED with scope ACCOUNT is an account-legal failure", () => {
    expect(isAccountLegalFailure({ code: "LEGAL_ACCEPTANCE_REQUIRED", details: { scope: "ACCOUNT", reason: "VERSION_NOT_CURRENT" } })).toBe(true);
    expect(isAccountLegalFailure({ code: "LEGAL_ACCEPTANCE_REQUIRED", details: { issues: [] } })).toBe(false);
    expect(isAccountLegalFailure({ code: "VALIDATION_ERROR", details: { scope: "ACCOUNT" } })).toBe(false);
  });
});

describe("P2-AC-09.c / P2-AC-10.b request stages: REQUEST / HOLD / REGISTRATION never blur", () => {
  const states = (status: Parameters<typeof requestStages>[0], mode: "FREE" | "EXTERNAL_WHATSAPP") => requestStages(status, mode).map((s) => `${s.key}:${s.state}`);

  test("WhatsApp pending: request done, hold current, registration open (not yet a registration)", () => {
    expect(states("PENDING_CONFIRMATION", "EXTERNAL_WHATSAPP")).toEqual(["request:done", "hold:current", "registration:open"]);
  });
  test("WhatsApp confirmed: all done", () => {
    expect(states("CONFIRMED", "EXTERNAL_WHATSAPP")).toEqual(["request:done", "hold:done", "registration:done"]);
  });
  test("expired / canceled: the hold is lost and no registration was created", () => {
    for (const status of ["EXPIRED", "CANCELED_BY_BUYER", "CANCELED_BY_STAFF"] as const) {
      expect(states(status, "EXTERNAL_WHATSAPP")).toEqual(["request:done", "hold:lost", "registration:lost"]);
    }
  });
  test("FREE has no hold stage at all", () => {
    expect(states("CONFIRMED", "FREE")).toEqual(["request:done", "registration:done"]);
  });
});

describe("effective expiry applies even if the worker has not run (Master 63/72)", () => {
  test("a stored PENDING request past expires_at is EXPIRED against the server clock", () => {
    expect(effectiveRequestStatus("PENDING_CONFIRMATION", "2026-10-04T12:00:00Z", new Date("2026-10-04T12:00:00Z"))).toBe("EXPIRED");
    expect(effectiveRequestStatus("PENDING_CONFIRMATION", "2026-10-04T12:00:00Z", new Date("2026-10-04T11:59:59Z"))).toBe("PENDING_CONFIRMATION");
    expect(effectiveRequestStatus("CONFIRMED", "2026-10-04T12:00:00Z", new Date("2026-10-05T00:00:00Z"))).toBe("CONFIRMED");
  });
});
