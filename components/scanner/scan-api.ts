import { apiFetch, newIdempotencyKey, type ApiFailure, type ApiResult } from "@/lib/client/api";
import { describeFailure, type AdminErrorView } from "@/components/admin/errors";
import { isScanOutcome, type ScanOperation, type ScanOutcome } from "@/components/scanner/outcomes";

/**
 * Browser side of the Race Day commands. The server is the only judge: every function here only builds the request the existing
 * API documents (app/api/v1/check-in, check-in/manual-verify, admin/kits/pickup, admin/guardian-verifications, participants/search)
 * and normalises the answer. A QR payload is passed through untouched (never parsed, never logged, never put in a URL).
 *
 * Retry contract: a request is a value (`ScanRequest`). Re-sending the SAME value after a network failure reuses its Idempotency-Key,
 * so a timed-out call that did reach the server can never apply twice; a NEW intent (e.g. the re-scan right after a guardian was
 * verified) builds a new request with a fresh key, because the old key would replay the stored "guardian required" answer.
 */
export type ParticipantMinimal = {
  registration_id: string;
  registration_number: string;
  registration_status: string;
  participant_kind: "PROFILE" | "GUEST";
  display_name: string | null;
  modality: { modality_id: string; name: string };
  category: { category_id: string; name: string } | null;
  is_minor: boolean;
  guardian_state: "PENDING" | "VERIFIED" | "REJECTED" | null;
};

export type ScanResult = {
  outcome: ScanOutcome;
  participant: ParticipantMinimal | null;
  /** Only the kit pickup command returns it; a VALID delivery's id is what a reversal needs. */
  kitPickupId: string | null;
};

export type ScanRequest = {
  path: string;
  body: Record<string, unknown>;
  /** Sent as Idempotency-Key when present (the QR check-in command has none: an outcome is idempotent by itself). */
  idempotencyKey: string | null;
};

/** What a scan attempt can be: the server answered with an outcome, or the request itself failed. */
export type ScanAttempt =
  | { kind: "outcome"; result: ScanResult }
  | { kind: "failure"; failure: ApiFailure; retryable: boolean };

const CHECK_IN = "/api/v1/check-in";
const MANUAL_VERIFY = "/api/v1/check-in/manual-verify";
const KIT_PICKUP = "/api/v1/admin/kits/pickup";

export type SessionIds = { editionId: string; station: string; kitDefinitionId: string | null };

/** QR scan: check-in or kit pickup, depending on the session operation. */
export function scanRequest(session: SessionIds, operation: ScanOperation, credentialToken: string): ScanRequest {
  if (operation === "KIT_PICKUP") {
    return {
      path: KIT_PICKUP,
      body: { edition_id: session.editionId, kit_definition_id: session.kitDefinitionId, credential_token: credentialToken, station_key: session.station },
      idempotencyKey: newIdempotencyKey(),
    };
  }
  return { path: CHECK_IN, body: { edition_id: session.editionId, credential_token: credentialToken, station_key: session.station }, idempotencyKey: null };
}

/** Manual check-in of a participant staff already resolved by search (SEC-032 MANUAL_VERIFY): a reason is mandatory. */
export function manualCheckInRequest(session: SessionIds, participantPassId: string, reason: string, idempotencyKey: string = newIdempotencyKey()): ScanRequest {
  return {
    path: MANUAL_VERIFY,
    body: { edition_id: session.editionId, participant_pass_id: participantPassId, reason: reason.trim(), station_key: session.station },
    idempotencyKey,
  };
}

/** Manual / third-party kit pickup for a resolved registration: a third party needs an explicit reason (J4 step 6). */
export function manualKitRequest(
  session: SessionIds,
  registrationId: string,
  thirdParty: { reason: string } | null,
  idempotencyKey: string = newIdempotencyKey(),
): ScanRequest {
  return {
    path: KIT_PICKUP,
    body: {
      edition_id: session.editionId,
      kit_definition_id: session.kitDefinitionId,
      registration_id: registrationId,
      station_key: session.station,
      ...(thirdParty ? { third_party: true, third_party_reason: thirdParty.reason.trim() } : {}),
    },
    idempotencyKey,
  };
}

/** Same request with a fresh Idempotency-Key (a new intent, not a retry). */
export function withFreshKey(request: ScanRequest): ScanRequest {
  return { ...request, idempotencyKey: request.idempotencyKey === null ? null : newIdempotencyKey() };
}

export function isRetryable(failure: ApiFailure): boolean {
  return failure.code === "NETWORK_ERROR" || failure.code === "DEPENDENCY_UNAVAILABLE" || failure.code === "RATE_LIMITED" || failure.status >= 500;
}

const GUARDIAN_STATES = ["PENDING", "VERIFIED", "REJECTED"];

function parseParticipant(value: unknown): ParticipantMinimal | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const modality = row.modality as Record<string, unknown> | undefined;
  if (typeof row.registration_id !== "string" || typeof row.registration_number !== "string" || !modality || typeof modality.name !== "string") return null;
  const category = row.category as Record<string, unknown> | null | undefined;
  return {
    registration_id: row.registration_id,
    registration_number: row.registration_number,
    registration_status: typeof row.registration_status === "string" ? row.registration_status : "",
    participant_kind: row.participant_kind === "GUEST" ? "GUEST" : "PROFILE",
    display_name: typeof row.display_name === "string" ? row.display_name : null,
    modality: { modality_id: String(modality.modality_id ?? ""), name: modality.name },
    category: category && typeof category.name === "string" ? { category_id: String(category.category_id ?? ""), name: category.name } : null,
    is_minor: row.is_minor === true,
    guardian_state: typeof row.guardian_state === "string" && GUARDIAN_STATES.includes(row.guardian_state) ? (row.guardian_state as ParticipantMinimal["guardian_state"]) : null,
  };
}

/**
 * Normalises a 200 body. An outcome that is not one of the 11 (a newer server, a corrupt body) is NOT shown as anything: it returns
 * null so the caller reports an unexpected answer instead of guessing a state, and a scan can never look successful by accident.
 */
export function parseScanResult(data: unknown): ScanResult | null {
  if (!data || typeof data !== "object") return null;
  const body = data as Record<string, unknown>;
  if (!isScanOutcome(body.outcome)) return null;
  return {
    outcome: body.outcome,
    participant: parseParticipant(body.participant),
    kitPickupId: typeof body.kit_pickup_id === "string" ? body.kit_pickup_id : null,
  };
}

type Fetcher = typeof apiFetch;

export async function sendScan(request: ScanRequest, fetcher: Fetcher = apiFetch): Promise<ScanAttempt> {
  const response: ApiResult<unknown> = await fetcher<unknown>(request.path, {
    method: "POST",
    body: request.body,
    ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
  });
  if (!response.ok) return { kind: "failure", failure: response, retryable: isRetryable(response) };
  const result = parseScanResult(response.data);
  if (!result) {
    return {
      kind: "failure",
      failure: { ok: false, status: response.status, code: "INTERNAL_ERROR", message: "", requestId: null, details: {} },
      retryable: false,
    };
  }
  return { kind: "outcome", result };
}

/** Operator-facing copy of a failed request. A malformed QR payload is the one validation error the scanner explains specially. */
export function describeScanFailure(failure: Pick<ApiFailure, "code" | "requestId" | "details">): AdminErrorView {
  const view = describeFailure(failure);
  if (failure.code === "VALIDATION_ERROR" && (failure.details as { field?: unknown }).field === "credential_token") {
    return { ...view, title: "Ese código no es de un pase", message: "Lo leído no tiene el formato de un pase de esta plataforma. Escanea de nuevo o busca a la persona por nombre.", action: "none" };
  }
  return view;
}

// ---- Participant lookup (SEC-024: at least 3 characters, rate limited, minimal fields) -------------------------------------

export type ParticipantHit = {
  registration_id: string;
  participant_pass_id: string | null;
  registration_number: string;
  display_name: string | null;
  modality: { modality_id: string; name: string };
  guardian_state: "PENDING" | "VERIFIED" | "REJECTED" | null;
};

export const MIN_SEARCH_LENGTH = 3;

/** The search route answers `data: [...]` (the service unwraps the RPC page); an `{ items }` envelope is accepted too. */
export function listItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const items = (data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items : [];
}

export function parseParticipantHits(data: unknown): ParticipantHit[] {
  const items = listItems(data);
  const hits: ParticipantHit[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const modality = row.modality as Record<string, unknown> | undefined;
    if (typeof row.registration_id !== "string" || typeof row.registration_number !== "string" || !modality || typeof modality.name !== "string") continue;
    hits.push({
      registration_id: row.registration_id,
      participant_pass_id: typeof row.participant_pass_id === "string" ? row.participant_pass_id : null,
      registration_number: row.registration_number,
      display_name: typeof row.display_name === "string" ? row.display_name : null,
      modality: { modality_id: String(modality.modality_id ?? ""), name: modality.name },
      guardian_state: typeof row.guardian_state === "string" && GUARDIAN_STATES.includes(row.guardian_state) ? (row.guardian_state as ParticipantHit["guardian_state"]) : null,
    });
  }
  return hits;
}

export function searchUrl(editionId: string, query: string): string {
  return `/api/v1/admin/editions/${encodeURIComponent(editionId)}/participants/search?q=${encodeURIComponent(query.trim())}`;
}

// ---- Guardian desk commands ---------------------------------------------------------------------------------------------------

export function guardianVerifyPath(registrationId: string): string {
  return `/api/v1/admin/guardian-verifications/${encodeURIComponent(registrationId)}/verify`;
}
export function guardianRejectPath(registrationId: string): string {
  return `/api/v1/admin/guardian-verifications/${encodeURIComponent(registrationId)}/reject`;
}

/**
 * In-person verification methods the desk can record as evidence. The API stores free text (1-100 characters), so these are
 * labels chosen by the product team's wording, not an enum the server enforces.
 */
export const GUARDIAN_METHODS = [
  "Identificación oficial del adulto",
  "Documento de custodia o autorización",
  "Conocido por el equipo del evento",
  "Otro (se explica en las notas)",
] as const;

export type GuardianDecision =
  | { ok: true; body: { verification_method: string; notes?: string } }
  | { ok: false; errors: { method?: string; notes?: string } };

export function buildGuardianVerify(input: { method: string; notes: string }): GuardianDecision {
  const method = input.method.trim();
  const notes = input.notes.trim();
  const errors: { method?: string; notes?: string } = {};
  if (method.length === 0) errors.method = "Elige cómo verificaste al adulto.";
  if (method.length > 100) errors.method = "Máximo 100 caracteres.";
  if (notes.length > 500) errors.notes = "Máximo 500 caracteres.";
  if (method.startsWith("Otro") && notes.length === 0) errors.notes = "Explica cómo lo verificaste.";
  if (errors.method || errors.notes) return { ok: false, errors };
  return { ok: true, body: { verification_method: method, ...(notes ? { notes } : {}) } };
}

export type RejectDecision = { ok: true; body: { reason: string } } | { ok: false; error: string };

export function buildGuardianReject(reasonText: string): RejectDecision {
  const reason = reasonText.trim();
  if (reason.length === 0) return { ok: false, error: "Indica por qué se rechaza: queda como evidencia." };
  if (reason.length > 500) return { ok: false, error: "Máximo 500 caracteres." };
  return { ok: true, body: { reason } };
}
