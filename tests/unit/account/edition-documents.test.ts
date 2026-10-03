import { describe, expect, test } from "vitest";
import {
  acceptDocumentsBody,
  acceptFailureCopy,
  buildEditionAcceptanceItems,
  editionDocumentsPath,
  subjectKey,
} from "@/components/account/logic/edition-documents";
import { bannerToShow, interpretCreateFailure } from "@/components/registration/logic/errors";
import type { PendingActionView } from "@/lib/client/account-types";
import { ID, MINOR_DOC, WAIVER_DOC } from "../registration/fixtures";

const OTHER_EDITION = "50000000-0000-4000-8000-0000000c00ff";
const selfAction = (editionId: string = ID.edition): PendingActionView => ({
  action_type: "LEGAL_ACCEPTANCE_REQUIRED",
  edition: { edition_id: editionId, name: "Demo Gratis 5K/10K", slug: "demo-gratis" },
  subject: { kind: "SELF" },
  documents: [{ legal_document_version_id: ID.waiver, document_type: "SPORT_WAIVER", version: 3 }],
});

/** What GET /me/pending-actions?edition_id= returns for a guardian since P2-G3: one item per ward, before any request exists. */
const wardAction = (subject: PendingActionView["subject"], versions: { id: string; type: string; version: number }[] = [{ id: ID.waiver, type: "SPORT_WAIVER", version: 3 }, { id: ID.minorTerms, type: "MINOR_TERMS", version: 1 }]): PendingActionView => ({
  action_type: "LEGAL_ACCEPTANCE_REQUIRED",
  edition: { edition_id: ID.edition, name: "Demo Gratis 5K/10K", slug: "demo-gratis" },
  subject,
  documents: versions.map((version) => ({ legal_document_version_id: version.id, document_type: version.type, version: version.version })),
});
const wardProfile = wardAction({ kind: "MINOR_PROFILE", public_profile_id: ID.minorProfile, display_name: "Dani Menor" });
const wardGuest = wardAction({ kind: "MINOR_GUEST", guest_participant_id: ID.guest, display_name: "Caro Menor" });

describe("P2-AC-03.d deep link", () => {
  test("the share link is the edition-scoped screen under /cuenta (a path safe-redirect already allows after sign-in)", () => {
    expect(editionDocumentsPath("demo-gratis")).toBe("/cuenta/documentos/evento/demo-gratis");
    expect(editionDocumentsPath("demo-gratis").split("/")[1]).toBe("cuenta");
  });
});

describe("P2-AC-03.c items to accept for an edition", () => {
  test("an adult Friend sees their own pending action for THIS edition, with the public text key of each version", () => {
    const items = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [selfAction()], contextDocuments: [WAIVER_DOC] });
    expect(items).toHaveLength(1);
    expect(items[0].subject).toEqual({ kind: "SELF" });
    expect(items[0].documents).toEqual([{ legal_document_version_id: ID.waiver, document_type: "SPORT_WAIVER", document_key: "SPORT_WAIVER", version: 3 }]);
  });

  test("another edition's action (the API also returns request-based actions) is not listed here", () => {
    expect(buildEditionAcceptanceItems({ editionId: ID.edition, actions: [selfAction(OTHER_EDITION)], contextDocuments: [WAIVER_DOC] })).toEqual([]);
  });

  test("P2-AC-03.f a guardian gets each ward the API lists (profile and Guest) even though no request exists yet (FREE confirms on submit)", () => {
    const items = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [wardProfile, wardGuest], contextDocuments: [WAIVER_DOC, MINOR_DOC] });
    // Stable order inside the minors: by subject key (guest: < profile:).
    expect(items.map((item) => item.subject)).toEqual([
      { kind: "MINOR_GUEST", guest_participant_id: ID.guest, display_name: "Caro Menor" },
      { kind: "MINOR_PROFILE", public_profile_id: ID.minorProfile, display_name: "Dani Menor" },
    ]);
    const profile = items[1];
    expect(profile.documents.map((document) => document.legal_document_version_id)).toEqual([ID.waiver, ID.minorTerms]);
    expect(profile.documents.map((document) => document.document_key)).toEqual(["SPORT_WAIVER", "MINOR_TERMS"]);
  });

  test("the guardian screen no longer needs the buyer's registration candidates: a ward is only what the API lists, never invented from the context", () => {
    expect(buildEditionAcceptanceItems({ editionId: ID.edition, actions: [], contextDocuments: [WAIVER_DOC, MINOR_DOC] })).toEqual([]);
  });

  test("a ward listed twice (profile in two requests) or in another edition is shown once / not at all", () => {
    expect(buildEditionAcceptanceItems({ editionId: ID.edition, actions: [wardProfile, wardProfile], contextDocuments: [WAIVER_DOC, MINOR_DOC] })).toHaveLength(1);
    expect(buildEditionAcceptanceItems({ editionId: OTHER_EDITION, actions: [wardProfile], contextDocuments: [WAIVER_DOC, MINOR_DOC] })).toEqual([]);
  });

  test("a version the context does not list falls back to the document type as its text key", () => {
    const [item] = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [wardProfile], contextDocuments: [WAIVER_DOC] });
    expect(item.documents.map((document) => document.document_key)).toEqual(["SPORT_WAIVER", "MINOR_TERMS"]);
  });

  test("own acceptance comes first, then minors", () => {
    const items = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [wardProfile, selfAction()], contextDocuments: [WAIVER_DOC, MINOR_DOC] });
    expect(items.map((item) => item.subject.kind)).toEqual(["SELF", "MINOR_PROFILE"]);
  });

  test("the POST body names exactly the versions shown and, for a minor, the minor (never for another adult)", () => {
    const [self, minor] = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [selfAction(), wardProfile], contextDocuments: [WAIVER_DOC, MINOR_DOC] });
    expect(acceptDocumentsBody(ID.edition, self)).toEqual({ edition_id: ID.edition, legal_document_version_ids: [ID.waiver] });
    expect(acceptDocumentsBody(ID.edition, minor)).toEqual({ edition_id: ID.edition, legal_document_version_ids: [ID.waiver, ID.minorTerms], minor_public_profile_id: ID.minorProfile });
    expect(subjectKey(minor.subject)).toBe(`profile:${ID.minorProfile}`);
  });

  test("a minor guest is sent as minor_guest_participant_id", () => {
    const [item] = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [wardGuest], contextDocuments: [WAIVER_DOC, MINOR_DOC] });
    expect(acceptDocumentsBody(ID.edition, item)).toEqual({ edition_id: ID.edition, legal_document_version_ids: [ID.waiver, ID.minorTerms], minor_guest_participant_id: ID.guest });
    expect(acceptDocumentsBody(ID.edition, item)).not.toHaveProperty("minor_public_profile_id");
    expect(subjectKey(item.subject)).toBe(`guest:${ID.guest}`);
  });
});

describe("failure copy", () => {
  test("session expiry offers sign-in; a moved version asks to refresh; rate limits wait", () => {
    expect(acceptFailureCopy({ code: "AUTH_REQUIRED", details: {} }).signIn).toBe(true);
    expect(acceptFailureCopy({ code: "VALIDATION_ERROR", details: { reason: "document_not_applicable" } }).refresh).toBe(true);
    expect(acceptFailureCopy({ code: "RATE_LIMITED", details: {} }).text).toMatch(/Espera/);
  });
});

describe("P2-AC-10.d single session-expired message", () => {
  test("an expired session on submit drops the generic banner (SessionExpiredAlert carries the one message)", () => {
    const action = interpretCreateFailure({ ok: false, status: 401, code: "AUTH_REQUIRED", message: "", requestId: null, details: {} }, []);
    expect(action.sessionExpired).toBe(true);
    expect(bannerToShow(action)).toBeNull();
  });

  test("any other failure keeps its banner", () => {
    const action = interpretCreateFailure({ ok: false, status: 0, code: "NETWORK_ERROR", message: "", requestId: null, details: {} }, []);
    expect(bannerToShow(action)).toEqual(action.banner);
  });
});
