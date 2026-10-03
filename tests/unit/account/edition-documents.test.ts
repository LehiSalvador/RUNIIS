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
import { candidate, ID, MINOR_DOC, WAIVER_DOC } from "../registration/fixtures";

const OTHER_EDITION = "50000000-0000-4000-8000-0000000c00ff";
const selfAction = (editionId: string = ID.edition): PendingActionView => ({
  action_type: "LEGAL_ACCEPTANCE_REQUIRED",
  edition: { edition_id: editionId, name: "Demo Gratis 5K/10K", slug: "demo-gratis" },
  subject: { kind: "SELF" },
  documents: [{ legal_document_version_id: ID.waiver, document_type: "SPORT_WAIVER", version: 3 }],
});

const ward = candidate({
  candidate_key: `profile:${ID.minorProfile}`,
  relation: "WARD",
  public_profile_id: ID.minorProfile,
  display_name: "Dani Menor",
  is_minor: true,
  acceptance: { required_document_version_ids: [ID.waiver, ID.minorTerms], missing_document_version_ids: [ID.waiver, ID.minorTerms], buyer_can_accept: true, acceptor: "GUARDIAN" },
});

describe("P2-AC-03.d deep link", () => {
  test("the share link is the edition-scoped screen under /cuenta (a path safe-redirect already allows after sign-in)", () => {
    expect(editionDocumentsPath("demo-gratis")).toBe("/cuenta/documentos/evento/demo-gratis");
    expect(editionDocumentsPath("demo-gratis").split("/")[1]).toBe("cuenta");
  });
});

describe("P2-AC-03.c items to accept for an edition", () => {
  test("an adult Friend sees their own pending action for THIS edition, with the public text key of each version", () => {
    const items = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [selfAction()], contextDocuments: [WAIVER_DOC], candidates: [] });
    expect(items).toHaveLength(1);
    expect(items[0].subject).toEqual({ kind: "SELF" });
    expect(items[0].documents).toEqual([{ legal_document_version_id: ID.waiver, document_type: "SPORT_WAIVER", document_key: "SPORT_WAIVER", version: 3 }]);
  });

  test("another edition's action (the API also returns request-based actions) is not listed here", () => {
    expect(buildEditionAcceptanceItems({ editionId: ID.edition, actions: [selfAction(OTHER_EDITION)], contextDocuments: [WAIVER_DOC], candidates: [] })).toEqual([]);
  });

  test("a guardian gets the minor they guard even though no request exists yet (FREE confirms on submit)", () => {
    const items = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [], contextDocuments: [WAIVER_DOC, MINOR_DOC], candidates: [ward] });
    expect(items).toHaveLength(1);
    expect(items[0].subject).toEqual({ kind: "MINOR_PROFILE", public_profile_id: ID.minorProfile, display_name: "Dani Menor" });
    expect(items[0].documents.map((document) => document.legal_document_version_id)).toEqual([ID.waiver, ID.minorTerms]);
  });

  test("nobody accepts for another adult: a Friend (PARTICIPANT) or another guardian's minor never becomes an item", () => {
    const friend = candidate({
      candidate_key: `profile:${ID.friendProfile}`,
      relation: "FRIEND",
      public_profile_id: ID.friendProfile,
      acceptance: { required_document_version_ids: [ID.waiver], missing_document_version_ids: [ID.waiver], buyer_can_accept: false, acceptor: "PARTICIPANT" },
    });
    const other = candidate({
      candidate_key: `profile:${ID.minorProfile}`,
      relation: "FRIEND",
      public_profile_id: ID.minorProfile,
      is_minor: true,
      acceptance: { required_document_version_ids: [ID.waiver], missing_document_version_ids: [ID.waiver], buyer_can_accept: false, acceptor: "OTHER_GUARDIAN" },
    });
    expect(buildEditionAcceptanceItems({ editionId: ID.edition, actions: [], contextDocuments: [WAIVER_DOC], candidates: [friend, other] })).toEqual([]);
  });

  test("a ward with nothing missing, or already listed by the API, is not duplicated", () => {
    const done = { ...ward, acceptance: { ...ward.acceptance, missing_document_version_ids: [] } };
    expect(buildEditionAcceptanceItems({ editionId: ID.edition, actions: [], contextDocuments: [WAIVER_DOC, MINOR_DOC], candidates: [done] })).toEqual([]);
    const fromApi: PendingActionView = { ...selfAction(), subject: { kind: "MINOR_PROFILE", public_profile_id: ID.minorProfile, display_name: "Dani Menor" } };
    const merged = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [fromApi], contextDocuments: [WAIVER_DOC, MINOR_DOC], candidates: [ward] });
    expect(merged).toHaveLength(1);
    expect(merged[0].documents.map((document) => document.legal_document_version_id)).toEqual([ID.waiver]);
  });

  test("own acceptance comes first, then minors", () => {
    const items = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [selfAction()], contextDocuments: [WAIVER_DOC, MINOR_DOC], candidates: [ward] });
    expect(items.map((item) => item.subject.kind)).toEqual(["SELF", "MINOR_PROFILE"]);
  });

  test("the POST body names exactly the versions shown and, for a minor, the minor (never for another adult)", () => {
    const [self, minor] = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [selfAction()], contextDocuments: [WAIVER_DOC, MINOR_DOC], candidates: [ward] });
    expect(acceptDocumentsBody(ID.edition, self)).toEqual({ edition_id: ID.edition, legal_document_version_ids: [ID.waiver] });
    expect(acceptDocumentsBody(ID.edition, minor)).toEqual({ edition_id: ID.edition, legal_document_version_ids: [ID.waiver, ID.minorTerms], minor_public_profile_id: ID.minorProfile });
    expect(subjectKey(minor.subject)).toBe(`profile:${ID.minorProfile}`);
  });

  test("a minor guest is sent as minor_guest_participant_id", () => {
    const guest = candidate({
      candidate_key: `guest:${ID.guest}`,
      relation: "GUEST",
      display_name: "Caro Menor",
      is_minor: true,
      acceptance: { required_document_version_ids: [ID.waiver], missing_document_version_ids: [ID.waiver], buyer_can_accept: true, acceptor: "GUARDIAN" },
    });
    const [item] = buildEditionAcceptanceItems({ editionId: ID.edition, actions: [], contextDocuments: [WAIVER_DOC], candidates: [guest] });
    expect(acceptDocumentsBody(ID.edition, item)).toMatchObject({ minor_guest_participant_id: ID.guest });
    expect(acceptDocumentsBody(ID.edition, item)).not.toHaveProperty("minor_public_profile_id");
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
