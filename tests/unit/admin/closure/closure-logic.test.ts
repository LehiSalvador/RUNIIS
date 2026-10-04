import { describe, expect, test } from "vitest";
import type { AttendanceWorkspace, AttendanceWorkspaceParticipant } from "@/lib/shared/closure";
import {
  EMPTY_FILTERS,
  blockersOf,
  canResolveAttendance,
  canResolveEligibility,
  checkDetail,
  closeFix,
  closeView,
  closureFailureCopy,
  creditSummary,
  dispositionOptions,
  eligibilityFormFor,
  filterRows,
  finalizeBlockingText,
  finalizeView,
  paginate,
  revisionText,
  stageOf,
  staleAfter,
  truncationText,
  validateAttendance,
  validateEligibility,
} from "@/components/admin/closure/closure-logic";

const EDITION = "5a000000-0000-4000-8000-00000000000a";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(n: number, patch: Partial<AttendanceWorkspaceParticipant> = {}): AttendanceWorkspaceParticipant {
  return {
    registration_id: id(n),
    registration_number: `I-AAAA-${String(n).padStart(4, "0")}`,
    participant_kind: "PROFILE",
    display_name: `Corredor ${n}`,
    modality: { modality_id: id(900), name: "10K" },
    attendance: { status: "PENDING", source: "INITIAL", reason: null, resolved_at: "2026-10-04T10:00:00Z" },
    eligibility: { status: "ELIGIBLE", distance_credit_disposition: "ALLOW", reason_code: null, resolved_at: "2026-10-04T10:00:00Z" },
    guardian_status: null,
    has_active_credit: false,
    ...patch,
  };
}

function workspace(patch: Partial<AttendanceWorkspace> = {}): AttendanceWorkspace {
  return {
    edition_id: EDITION,
    universe_count: 4,
    attendance_counts: { PENDING: 2, PRESENT: 2 },
    eligibility_counts: { ELIGIBLE: 4 },
    disposition_pending_count: 0,
    current_finalization: null,
    current_closure: null,
    finalize_readiness: {
      ready: false,
      expected_count: 4,
      checks: [
        { code: "EXECUTION_FINISHED", ok: true },
        { code: "NOT_ALREADY_FINALIZED", ok: true },
        { code: "NO_PENDING_ATTENDANCE", ok: false, detail: { pending_count: 2 } },
        { code: "NO_PENDING_ELIGIBILITY", ok: true, detail: { pending_count: 0 } },
      ],
    },
    close_readiness: { ready: false, checks: [{ code: "FINALIZATION_CURRENT", ok: false }] },
    participants: [row(1), row(2)],
    participants_truncated: false,
    participants_cap: 2000,
    ...patch,
  };
}

const finalization = { attendance_finalization_id: id(50), edition_id: EDITION, revision: 1, status: "FINALIZED" as const, expected_count: 4, present_count: 2, no_show_count: 2, excluded_count: 0, finalized_by_staff_id: id(60), finalized_at: "2026-10-04T12:00:00Z" };
const closure = { administrative_closure_id: id(70), edition_id: EDITION, revision: 1, attendance_finalization_id: id(50), status: "CLOSED" as const, closed_by_staff_id: id(60), closed_at: "2026-10-04T13:00:00Z" };

describe("stage and what can be edited", () => {
  test("the stage comes from the server projection: open, finalized, closed", () => {
    expect(stageOf(workspace())).toBe("OPEN");
    expect(stageOf(workspace({ current_finalization: finalization }))).toBe("FINALIZED");
    expect(stageOf(workspace({ current_finalization: finalization, current_closure: closure }))).toBe("CLOSED");
  });

  test("attendance is editable until finalized; eligibility until closed", () => {
    const open = workspace();
    const finalized = workspace({ current_finalization: finalization });
    const closed = workspace({ current_finalization: finalization, current_closure: closure });
    expect([canResolveAttendance(open), canResolveAttendance(finalized), canResolveAttendance(closed)]).toEqual([true, false, false]);
    expect([canResolveEligibility(open), canResolveEligibility(finalized), canResolveEligibility(closed)]).toEqual([true, true, false]);
  });
});

describe("readiness and the blocking list", () => {
  test("a failing check carries its concrete detail", () => {
    expect(checkDetail({ code: "NO_PENDING_ATTENDANCE", ok: false, detail: { pending_count: 1 } })).toBe("1 inscripción pendiente");
    expect(checkDetail({ code: "NO_PENDING_ELIGIBILITY", ok: false, detail: { pending_count: 3 } })).toBe("3 créditos por decidir");
    expect(checkDetail({ code: "GUARDIAN_RESOLVED", ok: false, detail: { pending_count: 2 } })).toBe("2 tutores por verificar");
    expect(checkDetail({ code: "UNIVERSE_STABLE", ok: false, detail: { universe_count: 9, finalized_count: 8 } })).toContain("Se finalizaron 8 y ahora hay 9");
    expect(checkDetail({ code: "NO_PENDING_ATTENDANCE", ok: true })).toBeNull();
    expect(checkDetail({ code: "EXECUTION_FINISHED", ok: false })).toBeNull();
  });

  test("blockers list only the failing checks, in the server's order", () => {
    const blockers = blockersOf(workspace().finalize_readiness.checks);
    expect(blockers.map((blocker) => blocker.code)).toEqual(["NO_PENDING_ATTENDANCE"]);
    expect(blockers[0].detail).toBe("2 inscripciones pendientes");
  });

  test("finalize shows BOTH blocking counts as text, and the bulk step only while rows are pending and the Edition is finished", () => {
    const blocked = workspace({ disposition_pending_count: 1 });
    const view = finalizeView(blocked);
    expect(view).toMatchObject({ ready: false, pendingAttendance: 2, pendingEligibility: 1, canMarkRemaining: true, stage: "OPEN" });
    expect(finalizeBlockingText(view)).toBe("No se puede finalizar: 2 inscripciones con asistencia pendiente; 1 crédito por decidir (elegibilidad).");

    const notFinished = workspace({
      finalize_readiness: { ready: false, expected_count: 4, checks: [{ code: "EXECUTION_FINISHED", ok: false }, { code: "NO_PENDING_ATTENDANCE", ok: false, detail: { pending_count: 2 } }] },
    });
    const early = finalizeView(notFinished);
    expect(early.canMarkRemaining).toBe(false);
    expect(finalizeBlockingText(early)).toContain("la edición todavía no está marcada como Realizada");

    const ready = finalizeView(workspace({ attendance_counts: { PRESENT: 4 }, finalize_readiness: { ready: true, expected_count: 4, checks: [{ code: "EXECUTION_FINISHED", ok: true }] } }));
    expect(ready.canMarkRemaining).toBe(false);
    expect(finalizeBlockingText(ready)).toBeNull();
    expect(finalizeBlockingText(finalizeView(workspace({ current_finalization: finalization })))).toBeNull();
  });

  test("close is for a global admin only, whatever the readiness says", () => {
    const ready = workspace({ current_finalization: finalization, close_readiness: { ready: true, checks: [] } });
    expect(closeView(ready, true)).toMatchObject({ ready: true, canAct: true, stage: "FINALIZED" });
    expect(closeView(ready, false)).toMatchObject({ ready: true, canAct: false });
    expect(closeView(workspace(), true).blockers.map((blocker) => blocker.code)).toEqual(["FINALIZATION_CURRENT"]);
  });

  test("each failing close check points to the screen that fixes it", () => {
    expect(closeFix(EDITION, "NO_PENDING_ATTENDANCE")?.href).toBe(`/admin/eventos/${EDITION}/asistencia`);
    expect(closeFix(EDITION, "UNIVERSE_STABLE")?.href).toBe(`/admin/eventos/${EDITION}/asistencia`);
    expect(closeFix(EDITION, "GUARDIAN_RESOLVED")?.href).toBe(`/admin/eventos/${EDITION}/tutores`);
    expect(closeFix(EDITION, "OFFICIAL_DISTANCE_KNOWN")?.href).toBe(`/admin/eventos/${EDITION}/modalidades`);
    expect(closeFix(EDITION, "SPORT_DATE_KNOWN")?.href).toBe(`/admin/eventos/${EDITION}/configuracion`);
    expect(closeFix(EDITION, "NO_OPEN_INTEGRITY_CASE")).toBeNull();
  });
});

describe("credit summary (read from the server projection)", () => {
  test("counts active credits by modality, never credits a guest and flags a violation of that rule", () => {
    const rows = [
      row(1, { has_active_credit: true, attendance: { status: "PRESENT", source: "CHECKIN", reason: null, resolved_at: null } }),
      row(2, { has_active_credit: true, modality: { modality_id: id(901), name: "5K" }, attendance: { status: "PRESENT", source: "MANUAL", reason: "x", resolved_at: null } }),
      row(3, { participant_kind: "GUEST", attendance: { status: "PRESENT", source: "CHECKIN", reason: null, resolved_at: null } }),
      row(4, { attendance: { status: "NO_SHOW", source: "MANUAL", reason: null, resolved_at: null } }),
    ];
    const summary = creditSummary(workspace({ participants: rows }));
    expect(summary).toMatchObject({ credited: 2, guestsCredited: 0, candidates: 2, partial: false });
    expect(summary.byModality).toEqual([
      { name: "10K", count: 1 },
      { name: "5K", count: 1 },
    ]);
    const broken = creditSummary(workspace({ participants: [row(1, { participant_kind: "GUEST", has_active_credit: true })] }));
    expect(broken.guestsCredited).toBe(1);
  });

  test("a capped list says the numbers cover only the rows it holds", () => {
    expect(creditSummary(workspace({ participants_truncated: true })).partial).toBe(true);
    expect(truncationText(workspace({ participants_truncated: true, universe_count: 2500, participants: Array.from({ length: 2000 }, (_, n) => row(n + 1)) }))).toContain("las primeras 2000 inscripciones de 2500");
    expect(truncationText(workspace())).toBeNull();
  });
});

describe("filters and pagination", () => {
  const rows = [
    row(1, { display_name: "Ángela Pérez", attendance: { status: "PRESENT", source: "CHECKIN", reason: null, resolved_at: null } }),
    row(2, { display_name: "Beto Ruiz" }),
    row(3, { display_name: "Carla Soto", modality: { modality_id: id(901), name: "5K" }, eligibility: { status: "DISQUALIFIED", distance_credit_disposition: "DENY", reason_code: null, resolved_at: null } }),
    row(4, { display_name: "Diego Paz", eligibility: { status: "PENDING_REVIEW", distance_credit_disposition: "PENDING", reason_code: null, resolved_at: null } }),
  ];

  test("status, modality, eligibility, origin and an accent-insensitive search combine", () => {
    expect(filterRows(rows, EMPTY_FILTERS)).toHaveLength(4);
    expect(filterRows(rows, { ...EMPTY_FILTERS, status: "PENDING" }).map((r) => r.display_name)).toEqual(["Beto Ruiz", "Carla Soto", "Diego Paz"]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, search: "angela" }).map((r) => r.display_name)).toEqual(["Ángela Pérez"]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, search: "i-aaaa-0003" }).map((r) => r.display_name)).toEqual(["Carla Soto"]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, modalityId: id(901) })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTERS, eligibility: "DISQUALIFIED" })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTERS, eligibility: "PENDING_DISPOSITION" }).map((r) => r.display_name)).toEqual(["Diego Paz"]);
    expect(filterRows(rows, { ...EMPTY_FILTERS, source: "CHECKIN" })).toHaveLength(1);
    expect(filterRows(rows, { ...EMPTY_FILTERS, status: "PENDING", search: "ruiz" })).toHaveLength(1);
  });

  test("pages are 1-based, clamped, and report the shown range", () => {
    const many = Array.from({ length: 130 }, (_, n) => n);
    expect(paginate(many, 1, 50)).toMatchObject({ page: 1, pageCount: 3, from: 1, to: 50, total: 130 });
    expect(paginate(many, 3, 50)).toMatchObject({ page: 3, from: 101, to: 130 });
    expect(paginate(many, 9, 50).page).toBe(3); // a filter that shrinks the list never leaves a page that no longer exists
    expect(paginate(many, 0, 50).page).toBe(1);
    expect(paginate([], 1, 50)).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0, total: 0 });
  });
});

describe("resolve attendance: the server's rules, checked before anything is sent", () => {
  test("PRESENT needs a reason and evidence (method + note); EXCLUDED a reason; NO_SHOW neither", () => {
    expect(validateAttendance({ status: "", reason: "", method: "", note: "" })).toMatchObject({ ok: false, errors: { status: expect.any(String) } });
    expect(validateAttendance({ status: "PRESENT", reason: "", method: "", note: "" })).toEqual({
      ok: false,
      errors: { reason: "Escribe por qué se cuenta como presente.", method: "Elige cómo se comprobó la llegada.", note: "Describe la evidencia: quién lo vio, dónde o qué se revisó." },
    });
    expect(validateAttendance({ status: "EXCLUDED", reason: "  ", method: "", note: "" })).toMatchObject({ ok: false, errors: { reason: "Escribe el motivo de la exclusión." } });
    expect(validateAttendance({ status: "NO_SHOW", reason: "", method: "", note: "" })).toEqual({ ok: true, body: { status: "NO_SHOW" } });
    expect(validateAttendance({ status: "PRESENT", reason: " Llegó ", method: "PAPER_LIST", note: " Lista firmada " })).toEqual({
      ok: true,
      body: { status: "PRESENT", reason: "Llegó", evidence_metadata: { method: "PAPER_LIST", note: "Lista firmada" } },
    });
    expect(validateAttendance({ status: "EXCLUDED", reason: "x".repeat(501), method: "", note: "" })).toMatchObject({ ok: false, errors: { reason: "Máximo 500 caracteres." } });
  });
});

describe("resolve eligibility", () => {
  test("PENDING is only the transient review value; a final decision chooses ALLOW or DENY", () => {
    expect(dispositionOptions("PENDING_REVIEW")).toEqual(["PENDING"]);
    expect(dispositionOptions("DISQUALIFIED")).toEqual(["ALLOW", "DENY"]);
    expect(dispositionOptions("ELIGIBLE")).toEqual(["ALLOW", "DENY"]);
    expect(dispositionOptions("")).toEqual([]);
  });

  test("DISQUALIFIED / EXCLUDED need an explicit decision and a reason; a review carries PENDING by itself", () => {
    expect(validateEligibility({ status: "DISQUALIFIED", disposition: "", reasonCode: "", reason: "" })).toEqual({
      ok: false,
      errors: { disposition: "Elige si se acredita la distancia (permitir o denegar).", reason: "Escribe el motivo: queda en la auditoría." },
    });
    expect(validateEligibility({ status: "EXCLUDED", disposition: "PENDING", reasonCode: "", reason: "x" })).toMatchObject({ ok: false, errors: { disposition: expect.any(String) } });
    expect(validateEligibility({ status: "DISQUALIFIED", disposition: "DENY", reasonCode: " CUT ", reason: " Atajo " })).toEqual({
      ok: true,
      body: { status: "DISQUALIFIED", distance_credit_disposition: "DENY", reason_code: "CUT", reason: "Atajo" },
    });
    expect(validateEligibility({ status: "PENDING_REVIEW", disposition: "", reasonCode: "", reason: "" })).toEqual({ ok: true, body: { status: "PENDING_REVIEW", distance_credit_disposition: "PENDING" } });
    expect(validateEligibility({ status: "ELIGIBLE", disposition: "ALLOW", reasonCode: "", reason: "" })).toEqual({ ok: true, body: { status: "ELIGIBLE", distance_credit_disposition: "ALLOW" } });
  });

  test("the form starts from the current resolution", () => {
    expect(eligibilityFormFor(row(1, { eligibility: { status: "DISQUALIFIED", distance_credit_disposition: "DENY", reason_code: "CUT", resolved_at: null } }))).toEqual({
      status: "DISQUALIFIED",
      disposition: "DENY",
      reasonCode: "CUT",
      reason: "",
    });
  });
});

describe("refusals of the closure commands", () => {
  test("not_ready lists the failing checks with their detail and refreshes", () => {
    const copy = closureFailureCopy(
      {
        code: "BUSINESS_RULE_VIOLATION",
        details: { reason: "not_ready", readiness: { ready: false, checks: [{ code: "NO_PENDING_ATTENDANCE", ok: false, detail: { pending_count: 2 } }, { code: "EXECUTION_FINISHED", ok: true }] } },
      },
      "finalize",
    );
    expect(copy).toMatchObject({ title: "La asistencia todavía no se puede finalizar", refresh: true });
    expect(copy?.lines).toEqual(["No queda asistencia pendiente: 2 inscripciones pendientes"]);
    expect(closureFailureCopy({ code: "BUSINESS_RULE_VIOLATION", details: { reason: "not_ready", readiness: { ready: false, checks: [] } } }, "close")?.title).toBe("La edición todavía no se puede cerrar");
  });

  test("each named reason has its own explanation", () => {
    expect(closureFailureCopy({ code: "BUSINESS_RULE_VIOLATION", details: { reason: "already_finalized" } }, "finalize")?.title).toBe("La asistencia ya estaba finalizada");
    expect(closureFailureCopy({ code: "BUSINESS_RULE_VIOLATION", details: { reason: "edition_not_finished" } }, "finalize")?.title).toBe("La edición todavía no terminó");
    expect(closureFailureCopy({ code: "BUSINESS_RULE_VIOLATION", details: { reason: "no_current_finalization" } }, "reopen_finalization")?.title).toBe("No hay una finalización vigente");
    expect(closureFailureCopy({ code: "BUSINESS_RULE_VIOLATION", details: { reason: "not_closed" } }, "reopen_edition")?.title).toBe("La edición no está cerrada");
    expect(closureFailureCopy({ code: "BUSINESS_RULE_VIOLATION", details: { reason: "not_in_universe" } }, "resolve_attendance")?.title).toBe("La inscripción ya no cuenta para la asistencia");
    expect(closureFailureCopy({ code: "CLOSURE_BLOCKED", details: { reason: "attendance_finalized" } }, "resolve_attendance")?.title).toBe("La asistencia está finalizada");
    expect(closureFailureCopy({ code: "CLOSURE_BLOCKED", details: { reason: "edition_closed" } }, "resolve_eligibility")?.message).toContain("administrador global debe reabrir el cierre");
    expect(closureFailureCopy({ code: "BUSINESS_RULE_VIOLATION", details: { reason: "something_new" } }, "close")).toBeNull();
  });

  test("a concurrent close is a stale-state explanation, a lock conflict is a safe retry", () => {
    expect(closureFailureCopy({ code: "CONFLICT", details: { reason: "invalid_transition", field: "closure_state", current: "CLOSED" } }, "close")).toMatchObject({ title: "La edición ya se cerró", refresh: true });
    expect(closureFailureCopy({ code: "CONFLICT", details: { retryable: true } }, "close")).toMatchObject({ refresh: false, message: expect.stringContaining("no se aplica dos veces") });
    expect(closureFailureCopy({ code: "CONFLICT", details: {} }, "resolve_attendance")?.refresh).toBe(true);
  });

  test("a 403 on close or reopen explains that it is global-admin only; elsewhere the shared model speaks", () => {
    expect(closureFailureCopy({ code: "FORBIDDEN", details: {} }, "close")?.title).toBe("Solo un administrador global puede hacerlo");
    expect(closureFailureCopy({ code: "FORBIDDEN", details: {} }, "reopen_edition")?.title).toBe("Solo un administrador global puede hacerlo");
    expect(closureFailureCopy({ code: "FORBIDDEN", details: {} }, "finalize")).toBeNull();
    expect(closureFailureCopy({ code: "RATE_LIMITED", details: {} }, "finalize")).toBeNull();
    expect(closureFailureCopy({ code: "NETWORK_ERROR", details: {} }, "finalize")).toBeNull();
  });

  test("validation issues name the field in plain language", () => {
    const copy = closureFailureCopy({ code: "VALIDATION_ERROR", details: { issues: [{ path: "evidence_metadata", message: "required" }, { path: "reason", message: "required" }] } }, "resolve_attendance");
    expect(copy?.lines).toEqual(["Falta la evidencia de la llegada.", "Falta el motivo o es demasiado largo."]);
    expect(closureFailureCopy({ code: "VALIDATION_ERROR", details: { header: "Idempotency-Key" } }, "close")).toBeNull();
  });

  test("only refusals that mean the screen is out of date re-read the workspace", () => {
    expect(staleAfter({ code: "CLOSURE_BLOCKED" })).toBe(true);
    expect(staleAfter({ code: "BUSINESS_RULE_VIOLATION" })).toBe(true);
    expect(staleAfter({ code: "CONFLICT", details: {} })).toBe(true);
    expect(staleAfter({ code: "CONFLICT", details: { retryable: true } })).toBe(false);
    expect(staleAfter({ code: "RATE_LIMITED" })).toBe(false);
    expect(staleAfter({ code: "NETWORK_ERROR" })).toBe(false);
    expect(staleAfter({ code: "INTERNAL_ERROR", status: 200 })).toBe(true); // a 200 that did not parse: the command may have applied
    expect(staleAfter({ code: "INTERNAL_ERROR", status: 500 })).toBe(false);
  });
});

describe("revision history", () => {
  test("the first revision is plain; later ones say how many were superseded", () => {
    expect(revisionText("finalization", 1)).toBe("Primera finalización.");
    expect(revisionText("closure", 2)).toContain("reemplaza una revisión anterior, sustituida");
    expect(revisionText("closure", 4)).toContain("reemplaza 3 revisiones anteriores, sustituidas");
  });
});
