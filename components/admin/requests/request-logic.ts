import { Ban, CircleCheck, CircleDashed, Hourglass, XCircle, type LucideIcon } from "lucide-react";
import { BULK_CANCEL_MAX_REQUESTS, type BulkCancelOutcome, type BulkCancelResult, type RequestStatus } from "@/lib/shared/registration";
import type { RegistrationRequestView } from "@/lib/shared/registration-views";
import type { BadgeTone } from "@/components/admin/status-badges";

/**
 * Pure logic of the external request queue (Master §70-73, UX J2). The server decides everything that matters (confirm, cancel,
 * capacity, price); this module only derives what to SHOW: the effective status (an expired request reads as expired even
 * when the worker has not run), the countdown from server time, which commands the row offers, and how a refusal reads.
 */
export type QueueRequest = RegistrationRequestView & { whatsapp_url: string | null };

/** `label` is the full name (filters, quick look); `short` is what the dense table badge shows. */
export const STATUS_SPEC: Record<RequestStatus, { label: string; short: string; tone: BadgeTone; icon: LucideIcon }> = {
  PENDING_CONFIRMATION: { label: "Pendiente de confirmar", short: "Pendiente", tone: "info", icon: Hourglass },
  CONFIRMED: { label: "Confirmada", short: "Confirmada", tone: "success", icon: CircleCheck },
  CANCELED_BY_BUYER: { label: "Cancelada por el comprador", short: "Cancelada (comprador)", tone: "neutral", icon: XCircle },
  CANCELED_BY_STAFF: { label: "Cancelada por el staff", short: "Cancelada (staff)", tone: "neutral", icon: XCircle },
  EXPIRED: { label: "Expirada", short: "Expirada", tone: "warning", icon: Ban },
};

export const STATUS_FILTER_OPTIONS: readonly { value: RequestStatus; label: string }[] = (
  ["PENDING_CONFIRMATION", "EXPIRED", "CONFIRMED", "CANCELED_BY_STAFF", "CANCELED_BY_BUYER"] as const
).map((value) => ({ value, label: STATUS_SPEC[value].label }));

export const UNKNOWN_STATUS_ICON = CircleDashed;

/** The effective status at `nowMs`: the server's own derivation, advanced locally if the expiry passes while the page is open. */
export function effectiveStatusAt(request: Pick<QueueRequest, "status" | "effective_status" | "expires_at">, nowMs: number): RequestStatus {
  if (request.effective_status === "PENDING_CONFIRMATION" && request.expires_at !== null && nowMs >= Date.parse(request.expires_at)) {
    return "EXPIRED";
  }
  return request.effective_status;
}

/** The moment "now" is, on the SERVER's clock, `elapsedMs` after the page was rendered (never the operator's own clock). */
export function serverNowMs(request: Pick<QueueRequest, "server_time">, elapsedMs: number): number {
  return Date.parse(request.server_time) + Math.max(0, elapsedMs);
}

export function remainingMs(request: Pick<QueueRequest, "expires_at">, nowMs: number): number | null {
  if (request.expires_at === null) return null;
  return Date.parse(request.expires_at) - nowMs;
}

/** "2 h 05 min", "12 min 05 s", "45 s"; "Vence ya" at or past zero. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Vence ya";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

/** Places a request holds: one per participant. */
export function placesOf(request: Pick<QueueRequest, "participants">): number {
  return request.participants.length;
}

export function holdState(effective: RequestStatus, request: Pick<QueueRequest, "participants">): { label: string; held: boolean } {
  const places = placesOf(request);
  const noun = places === 1 ? "lugar" : "lugares";
  if (effective === "PENDING_CONFIRMATION") return { label: `${places} ${noun} apartado${places === 1 ? "" : "s"} hasta que expire`, held: true };
  if (effective === "EXPIRED") return { label: "El apartado venció: el cupo ya no está retenido", held: false };
  if (effective === "CONFIRMED") return { label: `${places} ${noun} confirmado${places === 1 ? "" : "s"}`, held: false };
  return { label: "Cupo liberado", held: false };
}

/** Which confirmation command applies: before expiry a plain confirm, after it the explicit revalidation (Master §71-72). */
export function confirmMode(request: Pick<QueueRequest, "status">, effective: RequestStatus): "confirm" | "revalidate" | null {
  if (request.status === "CONFIRMED" || request.status === "CANCELED_BY_BUYER" || request.status === "CANCELED_BY_STAFF") return null;
  return effective === "PENDING_CONFIRMATION" ? "confirm" : "revalidate";
}

/** Staff may cancel a pending or an expired request that was not confirmed (Master §73). */
export function canCancelRequest(request: Pick<QueueRequest, "status">): boolean {
  return request.status === "PENDING_CONFIRMATION" || request.status === "EXPIRED";
}

/**
 * Bulk cancel is for requests still PENDING in the database (an expired one the worker has not materialised yet is included: the server
 * releases it). A confirmed, buyer-canceled or materialised-expired request is never selectable: a CONFIRMED registration is not
 * a request, and the bulk command never touches it.
 */
export function canBulkCancel(request: Pick<QueueRequest, "status">): boolean {
  return request.status === "PENDING_CONFIRMATION";
}

export function bulkEligibleIds(requests: readonly Pick<QueueRequest, "registration_request_id" | "status">[]): string[] {
  return requests.filter(canBulkCancel).map((request) => request.registration_request_id);
}

/** Keeps only ids that are still selectable in the current page (a refresh or a filter change can drop rows). */
export function pruneSelection(selected: ReadonlySet<string>, requests: readonly Pick<QueueRequest, "registration_request_id" | "status">[]): Set<string> {
  const eligible = new Set(bulkEligibleIds(requests));
  return new Set([...selected].filter((id) => eligible.has(id)));
}

export function selectionSummary(selected: ReadonlySet<string>, requests: readonly QueueRequest[]): { requests: number; places: number } {
  let places = 0;
  let count = 0;
  for (const request of requests) {
    if (!selected.has(request.registration_request_id)) continue;
    count += 1;
    places += placesOf(request);
  }
  return { requests: count, places };
}

export { BULK_CANCEL_MAX_REQUESTS };

// ---- Bulk results ------------------------------------------------------------------------------------------------------------

export const BULK_OUTCOME_SPEC: Record<BulkCancelOutcome, { label: string; tone: BadgeTone }> = {
  CANCELED: { label: "Cancelada", tone: "success" },
  ALREADY_CANCELED: { label: "Ya estaba cancelada", tone: "neutral" },
  NOT_CANCELABLE: { label: "No se puede cancelar", tone: "warning" },
  NOT_FOUND: { label: "No encontrada", tone: "warning" },
  FAILED: { label: "Falló", tone: "danger" },
};

export function bulkOutcomeText(row: BulkCancelResult["results"][number]): string {
  const spec = BULK_OUTCOME_SPEC[row.outcome];
  if (row.outcome === "NOT_CANCELABLE" && row.status && isRequestStatus(row.status)) return `Ya estaba: ${STATUS_SPEC[row.status].label.toLowerCase()}`;
  if (row.outcome === "FAILED") return "No se pudo cancelar. Reintenta solo esta solicitud.";
  return spec.label;
}

function isRequestStatus(value: string): value is RequestStatus {
  return Object.hasOwn(STATUS_SPEC, value);
}

/** One sentence that says what the batch did, counts only. */
export function bulkSummary(result: BulkCancelResult): string {
  const parts: string[] = [];
  if (result.canceled_count > 0) parts.push(`${result.canceled_count} cancelada${result.canceled_count === 1 ? "" : "s"}`);
  if (result.already_canceled_count > 0) parts.push(`${result.already_canceled_count} ya estaba${result.already_canceled_count === 1 ? "" : "n"} cancelada${result.already_canceled_count === 1 ? "" : "s"}`);
  if (result.rejected_count > 0) parts.push(`${result.rejected_count} sin cambios`);
  if (result.failed_count > 0) parts.push(`${result.failed_count} con error`);
  return parts.length === 0 ? "No se canceló ninguna solicitud." : `${parts.join(", ")} de ${result.requested_count}.`;
}

export function failedIds(result: BulkCancelResult): string[] {
  return result.results.filter((row) => row.outcome === "FAILED").map((row) => row.registration_request_id);
}

// ---- Refusals ----------------------------------------------------------------------------------------------------------------

export type FailureLike = { code: string; details?: Record<string, unknown> | null };

type Issue = { participant_index?: unknown; code?: unknown };

const ISSUE_TEXT: Record<string, string> = {
  LEGAL_ACCEPTANCE_REQUIRED: "falta aceptar los documentos legales",
  PARTICIPANT_NOT_ELIGIBLE: "ya no cumple las reglas de la modalidad",
  DUPLICATE_REGISTRATION: "ya tiene una inscripción confirmada en esta edición",
  GUARDIAN_REQUIRED: "falta el adulto responsable",
};

/** Per-participant blocking reasons the confirm command reports (`details.issues[]`), as one line per participant. */
export function blockingLines(failure: FailureLike, participants: readonly { display_name: string | null }[]): string[] {
  const issues = failure.details?.issues;
  if (!Array.isArray(issues)) return [];
  const lines: string[] = [];
  for (const raw of issues as Issue[]) {
    const index = typeof raw.participant_index === "number" ? raw.participant_index : null;
    const code = typeof raw.code === "string" ? raw.code : "";
    const who = index !== null && participants[index] ? (participants[index].display_name ?? `Participante ${index + 1}`) : "Un participante";
    lines.push(`${who}: ${ISSUE_TEXT[code] ?? "no cumple un requisito de la confirmación"}.`);
  }
  return lines;
}

/** `PRICE_CHANGED` carries the snapshot and the current total so staff can coordinate before acknowledging. */
export function priceChange(failure: FailureLike): { snapshotMinor: number; currentMinor: number; currency: string } | null {
  if (failure.code !== "PRICE_CHANGED") return null;
  const d = failure.details ?? {};
  const snapshot = d.snapshot_total_minor;
  const current = d.current_total_minor;
  const currency = d.currency;
  if (typeof snapshot !== "number" || typeof current !== "number" || typeof currency !== "string") return null;
  return { snapshotMinor: snapshot, currentMinor: current, currency };
}

const TRANSIENT_CODES = new Set(["NETWORK_ERROR", "RATE_LIMITED", "DEPENDENCY_UNAVAILABLE", "INTERNAL_ERROR"]);

/**
 * A failure that says nothing about the decision itself (lost connection, rate limit, lock contention, server error): the retry is the SAME
 * intent and reuses its Idempotency-Key. Any other refusal ends the intent: the next press is a new decision under a new key.
 */
export function isTransientFailure(failure: FailureLike): boolean {
  return TRANSIENT_CODES.has(failure.code) || (failure.code === "CONFLICT" && failure.details?.retryable === true);
}

export type RequestFailureCopy = { title: string; message: string; lines: string[]; refreshes: boolean };

const CONFLICT_REASON: Record<string, { title: string; message: string; refreshes: boolean }> = {
  REQUEST_CANCELED: { title: "La solicitud ya fue cancelada", message: "Otra persona (o el comprador) la canceló antes. No se confirmó nada. Actualiza la lista.", refreshes: true },
  REQUEST_NOT_CANCELABLE: { title: "La solicitud ya no se puede cancelar", message: "Ya está confirmada o cerrada. Actualiza la lista para ver su estado.", refreshes: true },
  REQUEST_NOT_EXPIRED: { title: "La solicitud sigue vigente", message: "Todavía no expira: confírmala sin revalidar. Actualiza la lista.", refreshes: true },
  CLAIMS_RELEASED: { title: "Ya no hay apartado vigente", message: "Los lugares de esta solicitud se liberaron. Usa revalidar y confirmar, o cancélala.", refreshes: true },
};

/**
 * Specific copy for the refusals a queue action can meet (J2 step 3). Returns null for everything else so the shared error model
 * (components/admin/errors.ts) speaks; the request_id is shown by that model in both cases.
 */
export function describeRequestFailure(failure: FailureLike, participants: readonly { display_name: string | null }[] = []): RequestFailureCopy | null {
  const reason = typeof failure.details?.reason === "string" ? failure.details.reason : "";
  if (failure.code === "LEGAL_ACCEPTANCE_REQUIRED") {
    return {
      title: "Falta la aceptación de términos",
      message: "Falta la aceptación de términos de uno o más participantes. No se puede confirmar hasta que la tengan.",
      lines: blockingLines(failure, participants),
      refreshes: false,
    };
  }
  if (failure.code === "PRICE_CHANGED") {
    return {
      title: "El precio cambió",
      message: "El precio cambió desde que se creó esta solicitud. Coordina con el comprador y vuelve a confirmar cuando estén de acuerdo.",
      lines: [],
      refreshes: false,
    };
  }
  if (failure.code === "CAPACITY_UNAVAILABLE" || failure.code === "GLOBAL_CAPACITY_UNAVAILABLE") {
    return {
      title: "Sin cupo",
      message: "Ya no hay cupo disponible para completar esta solicitud. Puedes cancelarla para avisar al comprador.",
      lines: [],
      refreshes: false,
    };
  }
  if (failure.code === "REQUEST_EXPIRED") {
    return {
      title: "La solicitud acaba de expirar",
      message: "Venció mientras la tenías abierta. Actualiza la lista: ahora se confirma con revalidar y confirmar.",
      lines: [],
      refreshes: true,
    };
  }
  if (failure.code === "CONFLICT" && CONFLICT_REASON[reason]) return { ...CONFLICT_REASON[reason], lines: [] };
  if (failure.code === "DUPLICATE_REGISTRATION" || failure.code === "PARTICIPANT_NOT_ELIGIBLE") {
    return {
      title: failure.code === "DUPLICATE_REGISTRATION" ? "Ya tiene una inscripción" : "Un participante ya no es elegible",
      message: "Hay participantes que ya no pueden confirmarse. Revisa el detalle y cancela la solicitud si corresponde.",
      lines: blockingLines(failure, participants),
      refreshes: false,
    };
  }
  return null;
}
