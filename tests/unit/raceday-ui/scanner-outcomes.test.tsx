import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { OPERATION_LABEL, OUTCOME_SPEC, SCAN_OUTCOMES, isScanOutcome, outcomeDetail } from "@/components/scanner/outcomes";
import { ScannerFeedback, type FeedbackView } from "@/components/scanner/scanner-feedback";
import { describeFailure } from "@/components/admin/errors";

// The 11 outcomes the server returns (lib/server/domain/raceday/contracts.ts scanOutcomeSchema), T13 §3.6 verbatim enum.
const SERVER_ENUM = [
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
] as const;

// T13 §3.6 table: outcome -> tone and label (accents added; the spec text is ASCII-folded).
const T13: Record<(typeof SERVER_ENUM)[number], { tone: string; label: string }> = {
  VALID: { tone: "success", label: "Acceso válido" },
  ALREADY_CHECKED_IN: { tone: "info", label: "Ya registrado" },
  REVOKED_CREDENTIAL: { tone: "danger", label: "Código revocado" },
  REPLACED_CREDENTIAL: { tone: "danger", label: "Este código ya no es válido, se reemplazó" },
  WRONG_EVENT: { tone: "danger", label: "Este pase no es de este evento" },
  REGISTRATION_NOT_CONFIRMED: { tone: "warning", label: "Inscripción no confirmada aún" },
  GUARDIAN_VERIFICATION_REQUIRED: { tone: "warning", label: "Requiere verificar guardián" },
  UNKNOWN_PASS: { tone: "danger", label: "Código no reconocido" },
  CANCELED_REGISTRATION: { tone: "danger", label: "Inscripción cancelada" },
  NOT_YET_ALLOWED: { tone: "warning", label: "Aún no es hora de ingreso" },
  OTHER_REVIEW: { tone: "warning", label: "Revisar manualmente" },
};

const participant = {
  registration_id: "72000000-0000-4000-8000-000000000001",
  registration_number: "I-ABCD-0001",
  registration_status: "CONFIRMED",
  participant_kind: "GUEST" as const,
  display_name: "Ana Prueba",
  modality: { modality_id: "60000000-0000-4000-8000-000000000001", name: "10K" },
  category: null,
  is_minor: false,
  guardian_state: null,
};

describe("scanner outcomes (T13 3.6)", () => {
  test("the table covers exactly the 11 server outcomes", () => {
    expect([...SCAN_OUTCOMES]).toEqual([...SERVER_ENUM]);
    expect(Object.keys(OUTCOME_SPEC).sort()).toEqual([...SERVER_ENUM].sort());
    expect(SERVER_ENUM).toHaveLength(11);
    for (const outcome of SERVER_ENUM) expect(isScanOutcome(outcome)).toBe(true);
    expect(isScanOutcome("PERFECTLY_FINE")).toBe(false);
    expect(isScanOutcome(undefined)).toBe(false);
  });

  test.each(SERVER_ENUM)("%s has the tone and label of T13 and a next step", (outcome) => {
    expect(OUTCOME_SPEC[outcome].tone).toBe(T13[outcome].tone);
    expect(OUTCOME_SPEC[outcome].label).toBe(T13[outcome].label);
    expect(OUTCOME_SPEC[outcome].action.length).toBeGreaterThan(10);
  });

  test("informational outcomes clear faster than the ones that route the person to the desk; the guardian screen never clears itself", () => {
    expect(OUTCOME_SPEC.VALID.dwellMs).toBeLessThan(OUTCOME_SPEC.OTHER_REVIEW.dwellMs);
    expect(OUTCOME_SPEC.ALREADY_CHECKED_IN.dwellMs).toBeLessThan(OUTCOME_SPEC.REVOKED_CREDENTIAL.dwellMs);
    expect(OUTCOME_SPEC.GUARDIAN_VERIFICATION_REQUIRED.dwellMs).toBe(0);
  });

  test("no scanner copy speaks of attendance: check-in is evidence of arrival, never the final record", () => {
    const copy = [
      ...SERVER_ENUM.flatMap((outcome) => [OUTCOME_SPEC[outcome].label, OUTCOME_SPEC[outcome].action, outcomeDetail(outcome, "EVENT_CHECKIN") ?? "", outcomeDetail(outcome, "KIT_PICKUP") ?? ""]),
      ...Object.values(OPERATION_LABEL),
    ].join(" ");
    expect(copy.toLowerCase()).not.toMatch(/asistencia|presente|ausente|no show/);
  });

  test("the kit desk reads a repeated scan as an already-delivered kit, with the T13 label unchanged", () => {
    expect(outcomeDetail("ALREADY_CHECKED_IN", "KIT_PICKUP")).toMatch(/Ya entregado/);
    expect(outcomeDetail("VALID", "KIT_PICKUP")).toBe("Kit entregado.");
    expect(outcomeDetail("VALID", "EVENT_CHECKIN")).toBe("Llegada registrada.");
  });
});

describe("ScannerFeedback", () => {
  test.each(SERVER_ENUM)("%s renders icon, label and tone on the first render, as an alert dialog", (outcome) => {
    const view: FeedbackView = { kind: "outcome", result: { outcome, participant, kitPickupId: null }, operation: "EVENT_CHECKIN" };
    const html = renderToStaticMarkup(<ScannerFeedback view={view} onDismiss={() => undefined} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(`data-testid="scan-outcome-${outcome}"`);
    expect(html).toContain(`data-tone="${T13[outcome].tone}"`);
    expect(html).toContain(T13[outcome].label);
    expect(html).toContain("<svg");
    expect(html).toContain("Ana Prueba");
    expect(html).toContain("Continuar");
  });

  test("a failed request is a distinct state: network loss says sin conexion, offers the retry and is never a valid outcome", () => {
    const view: FeedbackView = { kind: "failure", error: describeFailure({ code: "NETWORK_ERROR", requestId: null }), retryable: true };
    const html = renderToStaticMarkup(<ScannerFeedback view={view} onDismiss={() => undefined} onRetry={() => undefined} />);
    expect(html).toContain('data-testid="scan-network-error"');
    expect(html).toContain("Sin conexión, reintenta");
    expect(html).toContain("Reintentar");
    expect(html).not.toContain("scan-outcome-VALID");
    expect(html).not.toContain("Acceso válido");
  });

  test("another failure keeps the support reference and shows no retry when it cannot help", () => {
    const view: FeedbackView = { kind: "failure", error: describeFailure({ code: "FORBIDDEN", requestId: "req_abc123" }), retryable: false };
    const html = renderToStaticMarkup(<ScannerFeedback view={view} onDismiss={() => undefined} />);
    expect(html).toContain("req_abc123");
    expect(html).not.toContain("Reintentar");
  });

  test("the blocked state after a rejected guardian names the consequence", () => {
    const html = renderToStaticMarkup(<ScannerFeedback view={{ kind: "guardian_blocked", participant }} onDismiss={() => undefined} />);
    expect(html).toContain("Verificación rechazada");
    expect(html).toContain("no puede hacer check-in");
  });

  test("the guardian panel is shown on top of the feedback, not instead of it", () => {
    const view: FeedbackView = { kind: "outcome", result: { outcome: "GUARDIAN_VERIFICATION_REQUIRED", participant: { ...participant, is_minor: true }, kitPickupId: null }, operation: "EVENT_CHECKIN" };
    const html = renderToStaticMarkup(<ScannerFeedback view={view} onDismiss={() => undefined} panel={<div id="the-panel">panel</div>} />);
    expect(html).toContain("Requiere verificar guardián");
    expect(html).toContain('id="the-panel"');
    expect(html).toContain("Menor de edad");
    // while the panel is up there is no "Continuar" shortcut around the decision
    expect(html).not.toContain("Continuar");
  });
});
