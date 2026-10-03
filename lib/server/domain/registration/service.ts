import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CreateRegistrationRequestBody } from "@/lib/shared/registration";
import {
  registrationContextRedirectSchema,
  registrationContextSchema,
  type RegistrationContext,
} from "@/lib/shared/registration-context";
import { buildWhatsAppUrl } from "@/lib/shared/whatsapp";
import { decodeCursor, encodeCursor } from "../../http/pagination";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import { createSystemClient } from "../../supabase/clients";
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

export async function createRegistrationRequest(
  supabase: SupabaseClient,
  body: CreateRegistrationRequestBody,
  idempotencyKey: string | null,
) {
  await consumeRateLimit(supabase, "registration_request.create");
  const view = await callRpc(
    supabase,
    "create_registration_request",
    {
      p_edition_id: body.edition_id,
      p_participants: body.participants,
      p_legal_acceptances: body.legal_acceptances,
      p_idempotency_key: idempotencyKey,
    },
    registrationRequestSchema,
  );
  logEvent("info", "registration_request_created", { registration_request_id: view.registration_request_id, status: view.status });
  // FREE confirms inline: issue credentials right after commit (A1). Never blocks the response.
  if (view.status === "CONFIRMED") {
    await issueCredentialsAfterCommit(createSystemClient(), view.registration_request_id);
  }
  return withWhatsAppUrl(view);
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
