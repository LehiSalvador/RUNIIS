import { describe, expect, test } from "vitest";
import type { ApiFailure } from "@/lib/client/api";
import { describeRefreshFailure, interpretCreateFailure } from "@/components/registration/logic/errors";
import { candidate, ID } from "./fixtures";

const order = [
  candidate({ candidate_key: "self", relation: "SELF", display_name: "Ana" }),
  candidate({ candidate_key: `guest:${ID.guest}`, relation: "GUEST", display_name: "Caro" }),
];

function failure(code: string, status: number, details: Record<string, unknown> = {}): ApiFailure {
  return { ok: false, status, code: code as ApiFailure["code"], message: "", requestId: null, details };
}

describe("P2-AC-05.b stale-state errors map to a refresh, never to trusting the old selection", () => {
  test.each([
    ["CAPACITY_UNAVAILABLE", 409],
    ["GLOBAL_CAPACITY_UNAVAILABLE", 409],
  ])("%s refreshes the context and sends the person back to the modality step", (code, status) => {
    const action = interpretCreateFailure(failure(code, status, { modality_id: ID.m5k }), order);
    expect(action.refreshContext).toBe(true);
    expect(action.goToStep).toBe("details");
    expect(action.banner.title).toBe("Ya no hay cupo disponible para completar esta solicitud.");
    expect(action.keepIdempotencyKey).toBe(false);
  });

  test.each([
    ["REGISTRATION_NOT_OPEN", "Las inscripciones aún no abren."],
    ["REGISTRATION_CLOSED", "Las inscripciones ya cerraron."],
    ["EDITION_NOT_REGISTRABLE", "Este evento no admite inscripciones en este momento."],
  ])("%s refreshes into the read-only view", (code, title) => {
    const action = interpretCreateFailure(failure(code, 422), order);
    expect(action.refreshContext).toBe(true);
    expect(action.banner.title).toBe(title);
  });

  test("price changed refreshes and lands on the review", () => {
    const action = interpretCreateFailure(failure("PRICE_CHANGED", 409), order);
    expect(action.refreshContext).toBe(true);
    expect(action.goToStep).toBe("review");
  });

  test("a pending request already exists: shows it (and refreshes so the pending view renders)", () => {
    const action = interpretCreateFailure(failure("CONFLICT", 409, { reason: "PENDING_REQUEST_EXISTS", registration_request_id: ID.request }), order);
    expect(action.existingRequestId).toBe(ID.request);
    expect(action.refreshContext).toBe(true);
    expect(action.banner.title).toBe("Ya tienes una solicitud pendiente para este evento");
  });
});

describe("P2-AC-06.b / P2-AC-07 server issues land on the right participant and field", () => {
  test("FORM_INVALID: field and category issues are mapped per participant, inputs untouched, step = details", () => {
    const action = interpretCreateFailure(
      failure("FORM_INVALID", 422, {
        issues: [
          { participant_index: 0, code: "FORM_INVALID", field_key: "shirt_size", reason: "required" },
          { participant_index: 1, code: "FORM_INVALID", field_key: "club", reason: "too_long" },
          { participant_index: 1, code: "FORM_INVALID", field_key: "category_id", reason: "required" },
        ],
      }),
      order,
    );
    expect(action.fieldErrors.self).toEqual({ shirt_size: "Este campo es obligatorio." });
    expect(action.fieldErrors[`guest:${ID.guest}`]).toEqual({ club: "La respuesta es muy larga." });
    expect(action.categoryErrors[`guest:${ID.guest}`]).toBe("Elige una categoría.");
    expect(action.goToStep).toBe("details");
    expect(action.refreshContext).toBe(false);
  });

  test("participant issues are marked on the row with the T12 copy and ask for a refresh", () => {
    const action = interpretCreateFailure(
      failure("PARTICIPANT_NOT_ELIGIBLE", 422, {
        issues: [
          { participant_index: 1, code: "PARTICIPANT_NOT_ELIGIBLE", reasons: ["MODALITY_RULE"] },
          { participant_index: 0, code: "DUPLICATE_REGISTRATION", reasons: [] },
        ],
      }),
      order,
    );
    expect(action.rowErrors[`guest:${ID.guest}`]).toEqual(["No cumple los requisitos de esta modalidad."]);
    expect(action.rowErrors.self).toEqual(["Ya tiene un lugar en este evento."]);
    expect(action.goToStep).toBe("participants"); // earliest step holding something to fix
    expect(action.refreshContext).toBe(true);
    expect(action.notices.join(" ")).toContain("Caro:");
  });

  test("GUARDIAN_REQUIRED goes to the participants step", () => {
    const action = interpretCreateFailure(failure("GUARDIAN_REQUIRED", 422, { issues: [{ participant_index: 0, code: "GUARDIAN_REQUIRED", reasons: ["GUARDIAN_REQUIRED"] }] }), order);
    expect(action.goToStep).toBe("participants");
    expect(action.rowErrors.self[0]).toMatch(/adulto responsable/);
  });

  test("LEGAL_ACCEPTANCE_REQUIRED (participant): row-level, legal step, distinguishes buyer vs participant acceptance", () => {
    const action = interpretCreateFailure(
      failure("LEGAL_ACCEPTANCE_REQUIRED", 422, {
        issues: [
          { participant_index: 0, code: "LEGAL_ACCEPTANCE_REQUIRED", reason: "BUYER_ACCEPTANCE_MISSING" },
          { participant_index: 1, code: "LEGAL_ACCEPTANCE_REQUIRED", reason: "PARTICIPANT_ACCEPTANCE_PENDING" },
        ],
      }),
      order,
    );
    expect(action.goToStep).toBe("legal");
    expect(action.accountLegal).toBe(false);
    expect(action.rowErrors.self[0]).toMatch(/Falta aceptar/);
    expect(action.rowErrors[`guest:${ID.guest}`][0]).toMatch(/desde su cuenta/);
  });

  test("LEGAL_ACCEPTANCE_REQUIRED scope ACCOUNT routes to the account acceptance and refreshes", () => {
    const action = interpretCreateFailure(failure("LEGAL_ACCEPTANCE_REQUIRED", 422, { scope: "ACCOUNT", reason: "ACCOUNT_DOCUMENTS", missing_document_version_ids: [ID.terms] }), order);
    expect(action.accountLegal).toBe(true);
    expect(action.goToStep).toBe("legal");
    expect(action.refreshContext).toBe(true);
  });

  test("duplicate_participant validation error is explained", () => {
    const action = interpretCreateFailure(failure("VALIDATION_ERROR", 400, { reason: "duplicate_participant" }), order);
    expect(action.banner.body).toBe("Hay una persona repetida en tu solicitud.");
  });
});

describe("infrastructure failures", () => {
  test("rate limit keeps the key, carries retry_after and never refreshes", () => {
    const action = interpretCreateFailure(failure("RATE_LIMITED", 429, { retry_after_seconds: 42 }), order);
    expect(action.retryAfterSeconds).toBe(42);
    expect(action.keepIdempotencyKey).toBe(true);
    expect(action.refreshContext).toBe(false);
  });

  test("network failure keeps the same Idempotency-Key so a retry cannot double-create", () => {
    const action = interpretCreateFailure(failure("NETWORK_ERROR", 0), order);
    expect(action.keepIdempotencyKey).toBe(true);
    expect(action.banner.body).toMatch(/no se duplicará/);
  });

  test("an idempotency conflict mints a new key", () => {
    const action = interpretCreateFailure(failure("IDEMPOTENCY_CONFLICT", 409), order);
    expect(action.keepIdempotencyKey).toBe(false);
  });

  test("session expired flags re-authentication and preserves the key", () => {
    const action = interpretCreateFailure(failure("AUTH_REQUIRED", 401), order);
    expect(action.sessionExpired).toBe(true);
    expect(action.keepIdempotencyKey).toBe(true);
  });

  test.each(["IDENTITY_LOCKED", "ACCOUNT_BANNED", "FORBIDDEN", "PROFILE_INCOMPLETE"])("%s is an account-state block (page reload renders the right screen)", (code) => {
    expect(interpretCreateFailure(failure(code, 403), order).accountBlocked).toBe(true);
  });

  test("an unknown 500 shows the catalogue text, never the server message", () => {
    const action = interpretCreateFailure({ ...failure("INTERNAL_ERROR", 500), message: "SELECT * FROM secrets" }, order);
    expect(action.banner.body).toBe("Algo salió mal. Intenta más tarde.");
  });

  test("a failed context refresh: session expiry and account blocks are flagged; rate limits get their own copy", () => {
    expect(describeRefreshFailure(failure("AUTH_REQUIRED", 401)).sessionExpired).toBe(true);
    expect(describeRefreshFailure(failure("IDENTITY_LOCKED", 403)).accountBlocked).toBe(true);
    expect(describeRefreshFailure(failure("RATE_LIMITED", 429)).message).toMatch(/Espera un momento/);
  });
});
