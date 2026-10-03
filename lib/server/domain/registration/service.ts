import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { JsonObject } from "@/lib/shared/api-contract";
import { changeModalityResultSchema, registrationStatusSchema, type CancelReasonCategory } from "@/lib/shared/closure";
import {
  REGISTRATION_CAPTCHA_PURPOSE,
  bulkCancelResultSchema,
  type BulkCancelRequestsBody,
  type CreateRegistrationRequestBody,
  type RegistrationCaptchaReason,
  type RegistrationCaptchaStatus,
} from "@/lib/shared/registration";
import {
  registrationContextRedirectSchema,
  registrationContextSchema,
  type RegistrationContext,
} from "@/lib/shared/registration-context";
import { buildWhatsAppUrl } from "@/lib/shared/whatsapp";
import { AppError } from "../../http/errors";
import { decodeCursor, encodeCursor } from "../../http/pagination";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import { createSystemClient } from "../../supabase/clients";
import { createAltchaChallenge, verifyAltchaPayload } from "../communications/captcha";
import { issueCredentialsAfterCommit } from "../passes/credentials";
import {
  acceptDocumentsResultSchema,
  adminRegistrationRequestPageSchema,
  participantExportSchema,
  participantPageSchema,
  pendingActionsSchema,
  registrationRequestPageSchema,
  registrationRequestSchema,
  type RegistrationRequestView,
} from "./contracts";

// Master §68: the WhatsApp handoff link is derived, never stored -- every view carries it alongside
// the snapshotted number so the buyer (and staff) can always re-open the same conversation.
function withWhatsAppUrl<T extends RegistrationRequestView>(view: T): T & { whatsapp_url: string | null } {
  if (!view.whatsapp_phone_e164) return { ...view, whatsapp_url: null };
  try {
    return {
      ...view,
      whatsapp_url: buildWhatsAppUrl({ phoneE164: view.whatsapp_phone_e164, editionName: view.edition.name, publicReference: view.public_reference }),
    };
  } catch {
    return { ...view, whatsapp_url: null };
  }
}

// Thin RPC layer over the registration commands (supabase/migrations/2026092814*). Authorisation,
// locking, capacity and eligibility live in the database; these functions add committed rate-limit
// pre-checks (A6), cursor encoding, strict result validation and the post-commit credential step (A1).

const requestCursorSchema = z.strictObject({ created_at: z.string().min(1), id: z.guid() });
const participantCursorSchema = z.strictObject({ sort_name: z.string(), id: z.guid() });
const precheckSchema = z.object({ allowed: z.literal(true) });

async function consumeRateLimit(supabase: SupabaseClient, scope: string): Promise<void> {
  await callRpc(supabase, "consume_actor_rate_limit", { p_scope: scope }, precheckSchema);
}

function readRequestCursor(cursor: string | undefined) {
  if (cursor === undefined) return { created_at: null, id: null };
  const decoded = decodeCursor(cursor, requestCursorSchema);
  return { created_at: decoded.created_at, id: decoded.id };
}

function writeRequestCursor(next: { created_at: string; registration_request_id: string } | null): string | null {
  return next ? encodeCursor({ created_at: next.created_at, id: next.registration_request_id }) : null;
}

function readParticipantCursor(cursor: string | undefined) {
  if (cursor === undefined) return { sort_name: null, id: null };
  const decoded = decodeCursor(cursor, participantCursorSchema);
  return { sort_name: decoded.sort_name, id: decoded.id };
}

function writeParticipantCursor(next: { sort_name: string; registration_id: string } | null): string | null {
  return next ? encodeCursor({ sort_name: next.sort_name, id: next.registration_id }) : null;
}

// ---- Buyer commands (Master §65-74) ----

// OD-P2-01 anti-hoarding. The database refuses an EXTERNAL_WHATSAPP request from an account younger than the policy window unless
// the buyer holds a single-use clearance (migration 721), and it checks that BEFORE any capacity or hold work. Next verifies the
// ALTCHA payload (HMAC + proof of work + single use) and mints the clearance with the service role. The order is deliberate:
// the RPC is tried first, so an idempotent replay (stored response) and every buyer the rule does not concern never touch
// the challenge, and a payload is only spent when the database says it is needed.
const captchaStatusRowSchema = z.strictObject({
  applies: z.boolean(),
  required: z.boolean(),
  has_clearance: z.boolean(),
  new_account_hours: z.int(),
});
const clearanceGrantSchema = z.object({ granted: z.literal(true) });
const CAPTCHA_CHALLENGE_ENDPOINT = "/api/v1/registration-requests/challenge";
const CAPTCHA_MESSAGES: Record<RegistrationCaptchaReason, string> = {
  captcha_required: "Confirma que eres una persona para enviar tu solicitud.",
  captcha_invalid: "La verificación no es válida o expiró. Inténtalo de nuevo.",
};

function isCaptchaRequired(error: unknown): error is AppError {
  return error instanceof AppError && error.code === "BUSINESS_RULE_VIOLATION" && error.details.reason === "captcha_required";
}

async function captchaError(reason: RegistrationCaptchaReason, editionId: string, newAccountHours: number): Promise<AppError> {
  const challenge = await createAltchaChallenge(REGISTRATION_CAPTCHA_PURPOSE);
  logEvent("info", "registration_captcha_challenged", { edition_id: editionId, reason });
  return new AppError("BUSINESS_RULE_VIOLATION", {
    message: CAPTCHA_MESSAGES[reason],
    details: {
      reason,
      captcha: {
        purpose: REGISTRATION_CAPTCHA_PURPOSE,
        edition_id: editionId,
        new_account_hours: newAccountHours,
        challenge: challenge as unknown as JsonObject,
        challenge_endpoint: CAPTCHA_CHALLENGE_ENDPOINT,
      },
    },
  });
}

export async function createRegistrationRequest(
  supabase: SupabaseClient,
  body: CreateRegistrationRequestBody,
  idempotencyKey: string | null,
  /** Auth user of the session behind `supabase`; the route passes it. Without it a challenged buyer can only be refused. */
  options: { authUserId?: string | null } = {},
) {
  await consumeRateLimit(supabase, "registration_request.create");
  const args = {
    p_edition_id: body.edition_id,
    p_participants: body.participants,
    p_legal_acceptances: body.legal_acceptances,
    p_idempotency_key: idempotencyKey,
  };
  const create = () => callRpc(supabase, "create_registration_request", args, registrationRequestSchema);

  let view: RegistrationRequestView;
  try {
    view = await create();
  } catch (error) {
    if (!isCaptchaRequired(error)) throw error;
    const captcha = (error.details.captcha ?? {}) as { new_account_hours?: unknown };
    const hours = typeof captcha.new_account_hours === "number" ? captcha.new_account_hours : 24;
    if (body.altcha === undefined || !options.authUserId) throw await captchaError("captcha_required", body.edition_id, hours);
    if (!(await verifyAltchaPayload(REGISTRATION_CAPTCHA_PURPOSE, body.altcha))) {
      throw await captchaError("captcha_invalid", body.edition_id, hours);
    }
    await callRpc(
      createSystemClient(),
      "grant_registration_captcha_clearance",
      { p_auth_user_id: options.authUserId, p_edition_id: body.edition_id },
      clearanceGrantSchema,
    );
    try {
      view = await create();
    } catch (retryError) {
      // The clearance was spent or expired in between: ask again rather than leak the internal state.
      if (isCaptchaRequired(retryError)) throw await captchaError("captcha_required", body.edition_id, hours);
      throw retryError;
    }
  }
  logEvent("info", "registration_request_created", { registration_request_id: view.registration_request_id, status: view.status });
  // FREE confirms inline: issue credentials right after commit (A1). Never blocks the response.
  if (view.status === "CONFIRMED") {
    await issueCredentialsAfterCommit(createSystemClient(), view.registration_request_id);
  }
  return withWhatsAppUrl(view);
}

/**
 * Proactive form of the challenge for the participant UI: does the rule apply to this buyer on this Edition and, when the widget has to
 * be shown before submitting, the challenge to solve. Never issues a challenge to a buyer who does not need one.
 */
export async function getRegistrationCaptchaStatus(supabase: SupabaseClient, editionId: string): Promise<RegistrationCaptchaStatus> {
  await consumeRateLimit(supabase, "registration.context");
  const row = await callRpc(supabase, "registration_captcha_status", { p_edition_id: editionId }, captchaStatusRowSchema);
  return { ...row, challenge: row.required ? await createAltchaChallenge(REGISTRATION_CAPTCHA_PURPOSE) : null };
}

export async function getRegistrationRequest(supabase: SupabaseClient, id: string) {
  const view = await callRpc(supabase, "get_registration_request", { p_registration_request_id: id }, registrationRequestSchema);
  return withWhatsAppUrl(view);
}

export async function listMyRegistrationRequests(supabase: SupabaseClient, status: string | undefined, cursor: string | undefined) {
  const after = readRequestCursor(cursor);
  const page = await callRpc(
    supabase,
    "list_my_registration_requests",
    { p_status: status ?? null, p_cursor_created_at: after.created_at, p_cursor_id: after.id, p_limit: 20 },
    registrationRequestPageSchema,
  );
  return { items: page.items.map(withWhatsAppUrl), nextCursor: writeRequestCursor(page.next_cursor) };
}

export async function cancelRegistrationRequest(supabase: SupabaseClient, id: string, reason: string | undefined, idempotencyKey: string | null) {
  const view = await callRpc(
    supabase,
    "cancel_registration_request",
    { p_registration_request_id: id, p_reason: reason ?? null, p_idempotency_key: idempotencyKey },
    registrationRequestSchema,
  );
  logEvent("info", "registration_request_canceled_by_buyer", { registration_request_id: id });
  return withWhatsAppUrl(view);
}

// ---- Staff commands (Master §70-73) ----

export async function adminListRegistrationRequests(
  supabase: SupabaseClient,
  editionId: string,
  filters: { status?: string; search?: string; cursor?: string; limit?: number },
) {
  const after = readRequestCursor(filters.cursor);
  const page = await callRpc(
    supabase,
    "admin_list_registration_requests",
    {
      p_edition_id: editionId,
      p_status: filters.status ?? null,
      p_search: filters.search ?? null,
      p_cursor_created_at: after.created_at,
      p_cursor_id: after.id,
      p_limit: filters.limit ?? 20,
    },
    adminRegistrationRequestPageSchema,
  );
  return { items: page.items.map(withWhatsAppUrl), nextCursor: writeRequestCursor(page.next_cursor), counts: page.counts ?? {} };
}

export async function confirmRegistrationRequest(supabase: SupabaseClient, id: string, idempotencyKey: string | null) {
  await consumeRateLimit(supabase, "admin.mutation");
  const view = await callRpc(supabase, "confirm_registration_request", { p_registration_request_id: id, p_idempotency_key: idempotencyKey }, registrationRequestSchema);
  logEvent("info", "registration_request_confirmed", { registration_request_id: id });
  await issueCredentialsAfterCommit(createSystemClient(), id);
  return withWhatsAppUrl(view);
}

export async function revalidateAndConfirmRegistrationRequest(
  supabase: SupabaseClient,
  id: string,
  expectedTotalMinor: number | undefined,
  idempotencyKey: string | null,
) {
  await consumeRateLimit(supabase, "admin.mutation");
  const view = await callRpc(
    supabase,
    "revalidate_and_confirm_registration_request",
    { p_registration_request_id: id, p_expected_total_minor: expectedTotalMinor ?? null, p_idempotency_key: idempotencyKey },
    registrationRequestSchema,
  );
  logEvent("info", "registration_request_revalidated_confirmed", { registration_request_id: id });
  await issueCredentialsAfterCommit(createSystemClient(), id);
  return withWhatsAppUrl(view);
}

export async function staffCancelRegistrationRequest(supabase: SupabaseClient, id: string, reason: string, idempotencyKey: string | null) {
  await consumeRateLimit(supabase, "admin.mutation");
  const view = await callRpc(
    supabase,
    "staff_cancel_registration_request",
    { p_registration_request_id: id, p_reason: reason, p_idempotency_key: idempotencyKey },
    registrationRequestSchema,
  );
  logEvent("info", "registration_request_canceled_by_staff", { registration_request_id: id });
  return withWhatsAppUrl(view);
}

/**
 * OD-P2-01 bulk cancellation of PENDING requests: explicit ids (<= 100), one reason, Edition scope and the single-cancel transition
 * enforced in the database (migration 722). Per-id outcomes are reported, never thrown: a CONFIRMED request, a buyer-canceled one or an id of
 * another Edition is rejected without effect. Reasons never reach the logs; ids and counts only.
 */
export async function staffBulkCancelRegistrationRequests(
  supabase: SupabaseClient,
  editionId: string,
  body: BulkCancelRequestsBody,
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "staff_bulk_cancel_registration_requests",
    { p_edition_id: editionId, p_request_ids: body.request_ids, p_reason: body.reason, p_idempotency_key: idempotencyKey },
    bulkCancelResultSchema,
  );
  logEvent("info", "registration_requests_bulk_canceled", {
    edition_id: editionId,
    requested: result.requested_count,
    canceled: result.canceled_count,
    rejected: result.rejected_count,
    failed: result.failed_count,
  });
  return result;
}

// ---- Participants list/export (Master §172) ----

export async function adminListParticipants(
  supabase: SupabaseClient,
  editionId: string,
  filters: {
    status?: string;
    modality_id?: string;
    type?: string;
    kit?: string;
    attendance?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  },
) {
  const after = readParticipantCursor(filters.cursor);
  const page = await callRpc(
    supabase,
    "admin_list_participants",
    {
      p_edition_id: editionId,
      p_status: filters.status ?? null,
      p_modality_id: filters.modality_id ?? null,
      p_participant_kind: filters.type ?? null,
      p_kit_status: filters.kit ?? null,
      p_attendance_status: filters.attendance ?? null,
      p_search: filters.search ?? null,
      p_cursor_name: after.sort_name,
      p_cursor_id: after.id,
      p_limit: filters.limit ?? 50,
    },
    participantPageSchema,
  );
  return { items: page.items, nextCursor: writeParticipantCursor(page.next_cursor), contactVisible: page.contact_visible };
}

export async function adminExportParticipants(
  supabase: SupabaseClient,
  editionId: string,
  reason: string,
  filters: { status?: string; modality_id?: string; type?: string; kit?: string; attendance?: string; search?: string },
) {
  await consumeRateLimit(supabase, "participant.export");
  const result = await callRpc(
    supabase,
    "admin_export_participants",
    {
      p_edition_id: editionId,
      p_reason: reason,
      p_status: filters.status ?? null,
      p_modality_id: filters.modality_id ?? null,
      p_participant_kind: filters.type ?? null,
      p_kit_status: filters.kit ?? null,
      p_attendance_status: filters.attendance ?? null,
      p_search: filters.search ?? null,
    },
    participantExportSchema,
  );
  logEvent("info", "participant_export", { edition_id: editionId, row_count: result.row_count, truncated: result.truncated });
  return result;
}

// ---- Pending actions / legal acceptance (Master §124) ----

export async function listMyPendingActions(supabase: SupabaseClient, editionId: string | undefined) {
  return callRpc(supabase, "list_my_pending_actions", { p_edition_id: editionId ?? null }, pendingActionsSchema);
}

export async function acceptEditionDocuments(
  supabase: SupabaseClient,
  editionId: string,
  versionIds: readonly string[],
  minorPublicProfileId: string | undefined,
  minorGuestParticipantId: string | undefined,
) {
  await consumeRateLimit(supabase, "legal.accept");
  const result = await callRpc(
    supabase,
    "accept_edition_documents",
    {
      p_edition_id: editionId,
      p_legal_document_version_ids: versionIds,
      p_minor_public_profile_id: minorPublicProfileId ?? null,
      p_minor_guest_participant_id: minorGuestParticipantId ?? null,
    },
    acceptDocumentsResultSchema,
  );
  logEvent("info", "edition_documents_accepted", { edition_id: editionId });
  return result;
}

// ---- Registration context read model (P2-B, Master §34-42, §61-76, §124) ----

const registrationContextResultSchema = z.union([registrationContextSchema, registrationContextRedirectSchema]).nullable();

/**
 * Server-authoritative context for /inscripcion/[slug]: edition state, availability, price, forms, event
 * documents, candidate participants with per-modality verdicts and the buyer's existing request/registrations.
 * NULL = unknown or unpublished slug (caller: 404). `{redirect: true, slug}` = historical slug (caller: 308).
 * Reads fresh (never cache): availability and holds change by the second (Master §60).
 */
export async function getRegistrationContext(
  supabase: SupabaseClient,
  slug: string,
): Promise<{ redirect: true; slug: string } | { redirect: false; context: RegistrationContext } | null> {
  await consumeRateLimit(supabase, "registration.context");
  const result = await callRpc(supabase, "get_registration_context", { p_slug: slug }, registrationContextResultSchema);
  if (result === null) return null;
  if (result.redirect) return { redirect: true, slug: result.slug };
  const { existing, ...rest } = result;
  return {
    redirect: false,
    context: {
      ...rest,
      existing: {
        pending_request: existing.pending_request ? withWhatsAppUrl(existing.pending_request) : null,
        registrations: existing.registrations,
      },
    },
  };
}

// ---- Confirmed-registration lifecycle (Master §77-79, OWN-04; supabase/migrations/20261004100300_713_*.sql) ----
// Authorisation (REGISTRATION_MANAGE, Edition scope from the registration row), rate limiting, locking, capacity and the
// cancellation policy live in the database (private.registration_cancel_policy_check). The participant is always emailed
// by the RegistrationCanceled outbox consumer (migration 714); the free-text reason never leaves staff surfaces.

export async function cancelConfirmedRegistration(
  supabase: SupabaseClient,
  registrationId: string,
  body: { reason: string; reason_category?: CancelReasonCategory },
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "cancel_registration",
    {
      p_registration_id: registrationId,
      p_reason: body.reason,
      p_reason_category: body.reason_category ?? "OTHER",
      p_idempotency_key: idempotencyKey,
    },
    registrationStatusSchema,
  );
  logEvent("info", "registration_canceled_by_staff", { registration_id: registrationId, reason_category: body.reason_category ?? "OTHER" });
  return result;
}

export async function changeRegistrationModality(
  supabase: SupabaseClient,
  registrationId: string,
  body: { new_modality_id: string; category_id?: string | null; reason: string },
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "change_registration_modality",
    {
      p_registration_id: registrationId,
      p_new_modality_id: body.new_modality_id,
      p_category_id: body.category_id ?? null,
      p_reason: body.reason,
      p_idempotency_key: idempotencyKey,
    },
    changeModalityResultSchema,
  );
  logEvent("info", "registration_modality_changed", { registration_id: registrationId, revision: result.revision });
  return result;
}

/**
 * Edition of a registration, for post-commit cache invalidation (REGISTRATION_MANAGE; the database checks the scope).
 * Best effort: the command already committed, so a failed lookup must not turn it into an error response.
 */
export async function registrationEditionIdForStaff(supabase: SupabaseClient, registrationId: string): Promise<string | null> {
  try {
    return await callRpc(supabase, "registration_edition_for_staff", { p_registration_id: registrationId }, z.guid());
  } catch {
    logEvent("warn", "registration_edition_lookup_failed", { registration_id: registrationId });
    return null;
  }
}
