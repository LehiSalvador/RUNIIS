import {
  ATTENDANCE_WORKSPACE_ROW_CAP,
  resolveAttendanceBodySchema,
  resolveSportingEligibilityBodySchema,
  type AttendanceWorkspace,
  type AttendanceWorkspaceParticipant,
} from "@/lib/shared/closure";
import { isTransientFailure } from "@/components/admin/requests/request-logic";

/**
 * Pure logic of the attendance desk, finalization and closure screens (P3-I). The server is the authority: everything here only decides what to
 * show, which copy to use and which body to send. Readiness, counts, credits and the history all come from the workspace the server returned.
 *
 * Wording rule (Master section 91, T12 J5): a check-in is EVIDENCE of arrival, never the final attendance. A row that the server pre-classified
 * as PRESENT by a check-in is labelled as such ("Preclasificado por check-in"); a row with no check-in stays "Pendiente", never "No se presentó".
 */

// ---- Labels ------------------------------------------------------------------------------------------------------------------------

export type AttendanceStatus = NonNullable<AttendanceWorkspaceParticipant["attendance"]["status"]>;
export type EligibilityStatus = NonNullable<AttendanceWorkspaceParticipant["eligibility"]["status"]>;
export type Disposition = NonNullable<AttendanceWorkspaceParticipant["eligibility"]["distance_credit_disposition"]>;

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  PENDING: "Pendiente",
  PRESENT: "Presente",
  NO_SHOW: "No se presentó",
  EXCLUDED: "Excluido",
};

/** The stat tiles and the status filter, in the order the desk shows them. */
export const ATTENDANCE_ORDER: readonly AttendanceStatus[] = ["PRESENT", "PENDING", "NO_SHOW", "EXCLUDED"];

export const SOURCE_LABEL: Record<string, string> = {
  INITIAL: "Sin resolver todavía",
  CHECKIN: "Preclasificado por check-in",
  MANUAL: "Resuelto por el staff",
  CORRECTION: "Corrección del staff",
};

export const ELIGIBILITY_LABEL: Record<EligibilityStatus, string> = {
  ELIGIBLE: "Elegible",
  DISQUALIFIED: "Descalificado",
  EXCLUDED: "Excluido (deportivo)",
  PENDING_REVIEW: "En revisión",
};

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  ALLOW: "Crédito permitido",
  DENY: "Crédito denegado",
  PENDING: "Crédito por decidir",
};

export const GUARDIAN_LABEL: Record<string, string> = {
  PENDING: "Tutor por verificar",
  VERIFIED: "Tutor verificado",
  REJECTED: "Tutor rechazado",
};

export const KIND_LABEL: Record<string, string> = { PROFILE: "Cuenta", GUEST: "Invitado" };

export const EVIDENCE_METHODS = [
  { value: "DESK_VERIFICATION", label: "Verificación en la mesa de llegada" },
  { value: "PAPER_LIST", label: "Lista de llegada en papel" },
  { value: "ID_CHECK", label: "Identificación oficial revisada" },
  { value: "OTHER", label: "Otro (explícalo en la nota)" },
] as const;

export function evidenceMethodLabel(value: string): string {
  return EVIDENCE_METHODS.find((method) => method.value === value)?.label ?? value;
}

export function displayName(row: Pick<AttendanceWorkspaceParticipant, "display_name" | "registration_number">): string {
  return row.display_name?.trim() || `Inscripción ${row.registration_number}`;
}

// ---- Stage and permissions --------------------------------------------------------------------------------------------------------

export type Stage = "OPEN" | "FINALIZED" | "CLOSED";

/** Where the Edition is in the cycle, read from the server projection (never from a local guess). */
export function stageOf(workspace: Pick<AttendanceWorkspace, "current_finalization" | "current_closure">): Stage {
  if (workspace.current_closure) return "CLOSED";
  if (workspace.current_finalization) return "FINALIZED";
  return "OPEN";
}

/** Attendance can be resolved until it is finalized (a finalization blocks it; the closure implies a finalization). */
export function canResolveAttendance(workspace: AttendanceWorkspace): boolean {
  return stageOf(workspace) === "OPEN";
}

/** Sporting eligibility stays editable after the finalization and is blocked once the Edition is closed. */
export function canResolveEligibility(workspace: AttendanceWorkspace): boolean {
  return stageOf(workspace) !== "CLOSED";
}

// ---- Readiness ---------------------------------------------------------------------------------------------------------------------

type Check = { code: string; ok: boolean; detail?: Record<string, unknown> };

export const READINESS_TEXT: Record<string, string> = {
  EXECUTION_FINISHED: "La edición ya terminó (estado Realizada)",
  NOT_ALREADY_FINALIZED: "La asistencia todavía no está finalizada",
  NO_PENDING_ATTENDANCE: "No queda asistencia pendiente",
  NO_PENDING_ELIGIBILITY: "No queda ningún crédito por decidir (elegibilidad)",
  NOT_ALREADY_CLOSED: "La edición todavía no está cerrada",
  FINALIZATION_CURRENT: "Hay una finalización de asistencia vigente",
  UNIVERSE_STABLE: "La asistencia no cambió después de finalizar",
  GUARDIAN_RESOLVED: "Los tutores de los menores presentes están verificados",
  NO_OPEN_INTEGRITY_CASE: "No hay casos de integridad abiertos que bloqueen el cierre",
  OFFICIAL_DISTANCE_KNOWN: "Las modalidades que acreditan distancia tienen distancia oficial",
  SPORT_DATE_KNOWN: "La fecha deportiva está definida",
};

function count(detail: Check["detail"], key: string): number | null {
  const value = detail?.[key];
  return typeof value === "number" ? value : null;
}

/** One line of context for a failing check ("3 inscripciones pendientes"), or null when the code carries none. */
export function checkDetail(check: Check): string | null {
  if (check.ok) return null;
  const d = check.detail;
  switch (check.code) {
    case "NO_PENDING_ATTENDANCE":
      return count(d, "pending_count") !== null ? `${plural(count(d, "pending_count")!, "inscripción pendiente", "inscripciones pendientes")}` : null;
    case "NO_PENDING_ELIGIBILITY":
      return count(d, "pending_count") !== null ? `${plural(count(d, "pending_count")!, "crédito por decidir", "créditos por decidir")}` : null;
    case "GUARDIAN_RESOLVED":
      return count(d, "pending_count") !== null ? `${plural(count(d, "pending_count")!, "tutor por verificar", "tutores por verificar")}` : null;
    case "NO_OPEN_INTEGRITY_CASE":
      return count(d, "open_count") !== null ? `${plural(count(d, "open_count")!, "caso abierto", "casos abiertos")}` : null;
    case "OFFICIAL_DISTANCE_KNOWN":
    case "SPORT_DATE_KNOWN":
      return count(d, "registration_count") !== null ? `${plural(count(d, "registration_count")!, "inscripción afectada", "inscripciones afectadas")}` : null;
    case "UNIVERSE_STABLE": {
      const universe = count(d, "universe_count");
      const finalized = count(d, "finalized_count");
      return universe !== null && finalized !== null ? `Se finalizaron ${finalized} y ahora hay ${universe}: reabre la finalización y vuelve a finalizar.` : "Reabre la finalización y vuelve a finalizar.";
    }
    default:
      return null;
  }
}

export function readinessText(code: string): string {
  return READINESS_TEXT[code] ?? code.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type Blocker = { code: string; label: string; detail: string | null };

export function blockersOf(checks: readonly Check[]): Blocker[] {
  return checks.filter((check) => !check.ok).map((check) => ({ code: check.code, label: readinessText(check.code), detail: checkDetail(check) }));
}

/** Where a failing close check is resolved. `null` when no staff screen does (the text says what to do). */
export function closeFix(editionId: string, code: string): { href: string; label: string } | null {
  const base = `/admin/eventos/${editionId}`;
  switch (code) {
    case "EXECUTION_FINISHED":
      return { href: base, label: "Resumen de la edición" };
    case "FINALIZATION_CURRENT":
    case "UNIVERSE_STABLE":
    case "NO_PENDING_ATTENDANCE":
    case "NO_PENDING_ELIGIBILITY":
      return { href: `${base}/asistencia`, label: "Asistencia" };
    case "GUARDIAN_RESOLVED":
      return { href: `${base}/tutores`, label: "Mesa de tutores" };
    case "OFFICIAL_DISTANCE_KNOWN":
      return { href: `${base}/modalidades`, label: "Modalidades" };
    case "SPORT_DATE_KNOWN":
      return { href: `${base}/configuracion`, label: "Datos y fechas" };
    default:
      return null;
  }
}

// ---- Finalize ----------------------------------------------------------------------------------------------------------------------

export type FinalizeView = {
  stage: Stage;
  ready: boolean;
  blockers: Blocker[];
  pendingAttendance: number;
  pendingEligibility: number;
  /** The bulk "mark the rest as no-show" scope: only offered while PENDING rows exist and the Edition is finished. */
  canMarkRemaining: boolean;
  executionFinished: boolean;
};

export function finalizeView(workspace: AttendanceWorkspace): FinalizeView {
  const checks = workspace.finalize_readiness.checks;
  const executionFinished = checks.find((check) => check.code === "EXECUTION_FINISHED")?.ok ?? false;
  const pendingAttendance = workspace.attendance_counts.PENDING ?? 0;
  const stage = stageOf(workspace);
  return {
    stage,
    ready: workspace.finalize_readiness.ready,
    blockers: blockersOf(checks).filter((blocker) => blocker.code !== "NOT_ALREADY_FINALIZED"),
    pendingAttendance,
    pendingEligibility: workspace.disposition_pending_count,
    canMarkRemaining: stage === "OPEN" && executionFinished && pendingAttendance > 0,
    executionFinished,
  };
}

/** "Faltan 3 de asistencia y 1 de crédito por decidir" next to the disabled button (T13 4.14: both blocking counts, as text, never only a tooltip). */
export function finalizeBlockingText(view: FinalizeView): string | null {
  if (view.stage !== "OPEN" || view.ready) return null;
  const parts: string[] = [];
  if (!view.executionFinished) parts.push("la edición todavía no está marcada como Realizada");
  if (view.pendingAttendance > 0) parts.push(plural(view.pendingAttendance, "inscripción con asistencia pendiente", "inscripciones con asistencia pendiente"));
  if (view.pendingEligibility > 0) parts.push(plural(view.pendingEligibility, "crédito por decidir (elegibilidad)", "créditos por decidir (elegibilidad)"));
  return parts.length > 0 ? `No se puede finalizar: ${parts.join("; ")}.` : "No se puede finalizar todavía: revisa la lista de pendientes.";
}

export type CloseView = {
  stage: Stage;
  ready: boolean;
  blockers: Blocker[];
  /** Close and reopen are global ADMIN only (Master section 145): any other viewer reads, never acts. */
  canAct: boolean;
};

export function closeView(workspace: AttendanceWorkspace, isGlobalAdmin: boolean): CloseView {
  return {
    stage: stageOf(workspace),
    ready: workspace.close_readiness.ready,
    blockers: blockersOf(workspace.close_readiness.checks).filter((blocker) => blocker.code !== "NOT_ALREADY_CLOSED"),
    canAct: isGlobalAdmin,
  };
}

// ---- Credit summary (read from the server projection) -----------------------------------------------------------------------------

export type CreditSummary = {
  /** Participants with an ACTIVE DistanceCredit now. */
  credited: number;
  /** Guests with an ACTIVE credit: the invariant says 0 (a Guest is never credited). Shown so a violation is visible, never hidden. */
  guestsCredited: number;
  byModality: { name: string; count: number }[];
  /** PRESENT + credit allowed + a runner account: the most a close can credit (the server also applies the modality rule and distance). */
  candidates: number;
  /** The list holds only the first rows when the server capped it: the numbers then cover those rows only. */
  partial: boolean;
};

export function creditSummary(workspace: AttendanceWorkspace): CreditSummary {
  const byModality = new Map<string, number>();
  let credited = 0;
  let guestsCredited = 0;
  let candidates = 0;
  for (const row of workspace.participants) {
    if (row.has_active_credit) {
      credited += 1;
      if (row.participant_kind === "GUEST") guestsCredited += 1;
      byModality.set(row.modality.name, (byModality.get(row.modality.name) ?? 0) + 1);
    }
    if (row.participant_kind === "PROFILE" && row.attendance.status === "PRESENT" && row.eligibility.distance_credit_disposition === "ALLOW") candidates += 1;
  }
  return {
    credited,
    guestsCredited,
    byModality: [...byModality.entries()].map(([name, n]) => ({ name, count: n })).sort((a, b) => a.name.localeCompare(b.name, "es")),
    candidates,
    partial: workspace.participants_truncated,
  };
}

// ---- Desk filters and pagination (client side: the workspace already holds the whole capped universe) -----------------------------

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type DeskFilters = {
  status: AttendanceStatus | "ALL";
  search: string;
  modalityId: string;
  eligibility: EligibilityStatus | "PENDING_DISPOSITION" | "ALL";
  source: string;
};

export const EMPTY_FILTERS: DeskFilters = { status: "ALL", search: "", modalityId: "", eligibility: "ALL", source: "ALL" };

export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filterRows(rows: readonly AttendanceWorkspaceParticipant[], filters: DeskFilters): AttendanceWorkspaceParticipant[] {
  const needle = normalizeText(filters.search);
  return rows.filter((row) => {
    if (filters.status !== "ALL" && row.attendance.status !== filters.status) return false;
    if (filters.modalityId && row.modality.modality_id !== filters.modalityId) return false;
    if (filters.eligibility === "PENDING_DISPOSITION") {
      if (row.eligibility.distance_credit_disposition !== "PENDING") return false;
    } else if (filters.eligibility !== "ALL" && row.eligibility.status !== filters.eligibility) return false;
    if (filters.source !== "ALL" && row.attendance.source !== filters.source) return false;
    if (needle) {
      const haystack = normalizeText(`${row.display_name ?? ""} ${row.registration_number}`);
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export function hasActiveFilters(filters: DeskFilters): boolean {
  return filters.status !== "ALL" || filters.search.trim() !== "" || filters.modalityId !== "" || filters.eligibility !== "ALL" || filters.source !== "ALL";
}

export type Page<T> = { rows: T[]; page: number; pageCount: number; from: number; to: number; total: number };

/** `page` is 1-based and clamped, so a filter that shrinks the list never leaves the view on a page that no longer exists. */
export function paginate<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: current, pageCount, from: total === 0 ? 0 : start + 1, to: start + slice.length, total };
}

export function truncationText(workspace: Pick<AttendanceWorkspace, "participants_truncated" | "universe_count" | "participants">): string | null {
  if (!workspace.participants_truncated) return null;
  return `La lista muestra las primeras ${workspace.participants.length || ATTENDANCE_WORKSPACE_ROW_CAP} inscripciones de ${workspace.universe_count}. Los conteos y la preparación son de toda la edición. Para una inscripción que no aparece, búscala en Participantes: se puede resolver desde allí.`;
}

// ---- Resolve attendance ------------------------------------------------------------------------------------------------------------

export type AttendanceForm = { status: "PRESENT" | "NO_SHOW" | "EXCLUDED" | ""; reason: string; method: string; note: string };
export type AttendanceErrors = { status?: string; reason?: string; method?: string; note?: string };

export function emptyAttendanceForm(): AttendanceForm {
  return { status: "", reason: "", method: "", note: "" };
}

/** Manual PRESENT needs a reason AND evidence; EXCLUDED a reason; NO_SHOW neither (Master section 91). A scan is evidence, a bare claim is not. */
export function validateAttendance(form: AttendanceForm): { ok: true; body: Record<string, unknown> } | { ok: false; errors: AttendanceErrors } {
  const errors: AttendanceErrors = {};
  const reason = form.reason.trim();
  const note = form.note.trim();
  if (!form.status) errors.status = "Elige el resultado de asistencia.";
  if (form.status === "PRESENT" || form.status === "EXCLUDED") {
    if (reason.length === 0) errors.reason = form.status === "PRESENT" ? "Escribe por qué se cuenta como presente." : "Escribe el motivo de la exclusión.";
  }
  if (reason.length > 500) errors.reason = "Máximo 500 caracteres.";
  if (form.status === "PRESENT") {
    if (!form.method) errors.method = "Elige cómo se comprobó la llegada.";
    if (note.length === 0) errors.note = "Describe la evidencia: quién lo vio, dónde o qué se revisó.";
    else if (note.length > 500) errors.note = "Máximo 500 caracteres.";
  }
  if (errors.status || errors.reason || errors.method || errors.note) return { ok: false, errors };
  const body: Record<string, unknown> = { status: form.status };
  if (reason) body.reason = reason;
  if (form.status === "PRESENT") body.evidence_metadata = { method: form.method, note };
  const parsed = resolveAttendanceBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, errors: { status: "Revisa los datos: el servidor no los aceptaría." } };
  return { ok: true, body: parsed.data };
}

// ---- Resolve sporting eligibility --------------------------------------------------------------------------------------------------

export type EligibilityForm = { status: EligibilityStatus | ""; disposition: Disposition | ""; reasonCode: string; reason: string };
export type EligibilityErrors = { status?: string; disposition?: string; reason?: string; reasonCode?: string };

export function eligibilityFormFor(row: AttendanceWorkspaceParticipant): EligibilityForm {
  const status = row.eligibility.status;
  const disposition = row.eligibility.distance_credit_disposition;
  return { status: status ?? "", disposition: disposition ?? "", reasonCode: row.eligibility.reason_code ?? "", reason: "" };
}

/** PENDING_REVIEW can only carry PENDING; an ELIGIBLE row never carries PENDING; DISQUALIFIED / EXCLUDED must choose ALLOW or DENY explicitly (J5.4). */
export function dispositionOptions(status: EligibilityStatus | ""): Disposition[] {
  if (status === "PENDING_REVIEW") return ["PENDING"];
  if (status === "") return [];
  return ["ALLOW", "DENY"];
}

export function validateEligibility(form: EligibilityForm): { ok: true; body: Record<string, unknown> } | { ok: false; errors: EligibilityErrors } {
  const errors: EligibilityErrors = {};
  const reason = form.reason.trim();
  const code = form.reasonCode.trim();
  if (!form.status) errors.status = "Elige la elegibilidad.";
  const disposition = form.status === "PENDING_REVIEW" ? "PENDING" : form.disposition;
  if (form.status && !disposition) errors.disposition = "Elige si se acredita la distancia (permitir o denegar).";
  else if (form.status && form.status !== "PENDING_REVIEW" && disposition === "PENDING") errors.disposition = "Un resultado final debe permitir o denegar el crédito.";
  if ((form.status === "DISQUALIFIED" || form.status === "EXCLUDED") && reason.length === 0) errors.reason = "Escribe el motivo: queda en la auditoría.";
  if (reason.length > 500) errors.reason = "Máximo 500 caracteres.";
  if (code.length > 64) errors.reasonCode = "Máximo 64 caracteres.";
  if (errors.status || errors.disposition || errors.reason || errors.reasonCode) return { ok: false, errors };
  const body: Record<string, unknown> = { status: form.status, distance_credit_disposition: disposition };
  if (code) body.reason_code = code;
  if (reason) body.reason = reason;
  const parsed = resolveSportingEligibilityBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, errors: { status: "Revisa los datos: el servidor no los aceptaría." } };
  return { ok: true, body: parsed.data };
}

// ---- Failures ----------------------------------------------------------------------------------------------------------------------

export type CommandKind = "resolve_attendance" | "resolve_eligibility" | "finalize" | "reopen_finalization" | "close" | "reopen_edition";

type FailureLike = { code: string; details?: Record<string, unknown> | null };

export type ClosureFailureCopy = {
  title: string;
  message: string;
  /** Concrete lines: the checks that were not ready, the fields the server flagged. */
  lines: string[];
  /** The screen changed under the operator: the workspace is read again. */
  refresh: boolean;
};

function failedReadinessLines(details: Record<string, unknown> | null | undefined): string[] {
  const readiness = details?.readiness;
  if (!readiness || typeof readiness !== "object") return [];
  const checks = (readiness as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return [];
  const lines: string[] = [];
  for (const raw of checks) {
    if (!raw || typeof raw !== "object") continue;
    const check = raw as Check;
    if (typeof check.code !== "string" || check.ok !== false) continue;
    const detail = checkDetail(check);
    lines.push(detail ? `${readinessText(check.code)}: ${detail}` : readinessText(check.code));
  }
  return lines;
}

const FIELD_TEXT: Record<string, string> = {
  reason: "Falta el motivo o es demasiado largo.",
  evidence_metadata: "Falta la evidencia de la llegada.",
  status: "El estado elegido no es válido.",
  distance_credit_disposition: "La decisión sobre el crédito no es válida para esa elegibilidad.",
};

function validationLines(details: Record<string, unknown> | null | undefined): string[] {
  const issues = details?.issues;
  if (!Array.isArray(issues)) return [];
  const lines = new Set<string>();
  for (const raw of issues) {
    const path = raw && typeof raw === "object" ? (raw as { path?: unknown }).path : undefined;
    const name = Array.isArray(path) ? String(path[0] ?? "") : typeof path === "string" ? path : "";
    if (FIELD_TEXT[name]) lines.add(FIELD_TEXT[name]);
  }
  return [...lines];
}

/**
 * Specific copy for the refusals of the closure commands (P3-C error table). Returns null for everything else, so the shared error model
 * (components/admin/errors.ts) speaks. The request reference is always shown by the caller, in both cases.
 */
export function closureFailureCopy(failure: FailureLike, kind: CommandKind): ClosureFailureCopy | null {
  const d = failure.details ?? {};
  const reason = typeof d.reason === "string" ? d.reason : "";

  if (failure.code === "FORBIDDEN" && (kind === "close" || kind === "reopen_edition")) {
    return {
      title: "Solo un administrador global puede hacerlo",
      message:
        "Cerrar y reabrir una edición está reservado a un administrador con acceso global (no basta ser administrador de una sola edición ni operador). No se cambió nada. Pídeselo a un administrador global.",
      lines: [],
      refresh: false,
    };
  }
  if (failure.code === "BUSINESS_RULE_VIOLATION") {
    switch (reason) {
      case "not_ready": {
        const lines = failedReadinessLines(d);
        return {
          title: kind === "close" ? "La edición todavía no se puede cerrar" : "La asistencia todavía no se puede finalizar",
          message: "El servidor encontró pendientes. No se cambió nada; resuelve lo siguiente y vuelve a intentar.",
          lines,
          refresh: true,
        };
      }
      case "edition_not_finished":
        return { title: "La edición todavía no terminó", message: "La asistencia se finaliza cuando la edición está Realizada. Márcala como realizada desde el resumen de la edición.", lines: [], refresh: true };
      case "already_finalized":
        return { title: "La asistencia ya estaba finalizada", message: "Otra persona la finalizó antes que tú. Actualizamos la pantalla con el resultado.", lines: [], refresh: true };
      case "no_current_finalization":
        return { title: "No hay una finalización vigente", message: "Alguien ya la reabrió. Actualizamos la pantalla.", lines: [], refresh: true };
      case "not_closed":
        return { title: "La edición no está cerrada", message: "No hay un cierre vigente que reabrir. Actualizamos la pantalla.", lines: [], refresh: true };
      case "not_in_universe":
        return { title: "La inscripción ya no cuenta para la asistencia", message: "Ya no está confirmada (por ejemplo, se canceló). Actualizamos la lista.", lines: [], refresh: true };
      default:
        return null;
    }
  }
  if (failure.code === "CLOSURE_BLOCKED") {
    if (reason === "edition_closed") {
      return {
        title: "La edición está cerrada",
        message: "Con el cierre vigente esto no se puede cambiar. Un administrador global debe reabrir el cierre primero (después, si hace falta, la finalización de asistencia).",
        lines: [],
        refresh: true,
      };
    }
    return {
      title: "La asistencia está finalizada",
      message: "Para cambiar la asistencia hay que reabrir primero la finalización. Actualizamos la pantalla.",
      lines: [],
      refresh: true,
    };
  }
  if (failure.code === "CONFLICT") {
    if (d.retryable === true) {
      return { title: "El servidor estaba ocupado", message: "Otra operación sobre la edición coincidió con la tuya. Reintenta: es seguro, no se aplica dos veces.", lines: [], refresh: false };
    }
    if (d.field === "closure_state" && d.current === "CLOSED") {
      return { title: "La edición ya se cerró", message: "Otra persona la cerró antes que tú (o el cierre ya se envió). No se duplicó nada. Actualizamos la pantalla con el resultado.", lines: [], refresh: true };
    }
    return { title: "Alguien más cambió esta información", message: "La pantalla estaba desactualizada. La actualizamos: revisa el estado actual y repite la acción si sigue haciendo falta.", lines: [], refresh: true };
  }
  if (failure.code === "NOT_FOUND") {
    return { title: "La edición o la inscripción ya no existe", message: "No se encontró el registro. Vuelve a la lista de ediciones.", lines: [], refresh: false };
  }
  if (failure.code === "VALIDATION_ERROR") {
    const lines = validationLines(d);
    return lines.length > 0 ? { title: "Revisa los datos", message: "El servidor no aceptó lo enviado.", lines, refresh: false } : null;
  }
  return null;
}

/** A refusal that says nothing about the decision (connection, limit, lock) retries the SAME intent under the SAME key; any other ends the intent. */
export function endsIntent(failure: FailureLike): boolean {
  return !isTransientFailure(failure);
}

/** The refusal means the screen is out of date (state changed, finalized, closed, already done): the workspace is read again. */
export function staleAfter(failure: FailureLike & { status?: number }): boolean {
  if (failure.code === "CLOSURE_BLOCKED" || failure.code === "BUSINESS_RULE_VIOLATION") return true;
  if (failure.code === "CONFLICT") return (failure.details ?? {}).retryable !== true;
  // The command answered 200 with something that did not match the contract: it may have applied, so read the truth.
  return failure.code === "INTERNAL_ERROR" && failure.status === 200;
}

// ---- Session history ---------------------------------------------------------------------------------------------------------------

export type HistoryEntry = { at: string; text: string };

/**
 * What the API reports about earlier revisions. The server returns only the CURRENT finalization and closure (with their revision number);
 * the superseded ones and the reversed credits are kept in the audit trail but no read API lists them yet (DISCOVERY in the unit
 * handoff). So the desk shows what is real: the revision numbers, and the results of the commands confirmed by the server in this session.
 */
export function revisionText(kind: "finalization" | "closure", revision: number): string {
  const noun = kind === "finalization" ? "finalización" : "cierre";
  if (revision <= 1) return `Primera ${noun}.`;
  return `Revisión ${revision}: reemplaza ${revision - 1 === 1 ? "una revisión anterior, sustituida" : `${revision - 1} revisiones anteriores, sustituidas`} (el historial se conserva en la auditoría).`;
}
