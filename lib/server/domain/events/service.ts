import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JsonObject } from "@/lib/shared/api-contract";
import { logEvent } from "../../log";
import { callRpc, mapRpcError } from "../../rpc";
import {
  adminEditionEditorSchema,
  adminEditionListSchema,
  adminEventListSchema,
  adminEventSchema,
  antiHoardingPolicySchema,
  EDITION_PRECONDITION_FIELD,
  categorySchema,
  contentBlockSchema,
  createEventBodySchema,
  deletedContentBlockResultSchema,
  deletedLocationResultSchema,
  deletedModalityResultSchema,
  deletedResultSchema,
  deletedScheduleItemResultSchema,
  editionSchema,
  editionTransitionResultSchema,
  editionUpdateResultSchema,
  eventSchema,
  formPublishResultSchema,
  globalCapacityResultSchema,
  kitDefinitionSchema,
  kitVariantResultSchema,
  legalDocumentListSchema,
  legalDocumentSchema,
  legalVersionPublishResultSchema,
  legalVersionSchema,
  locationSchema,
  modalitySchema,
  modalityCapacityResultSchema,
  modalityStatusResultSchema,
  platformSettingsSchema,
  priceOfferResultSchema,
  publicLegalDocumentSchema,
  registrationFormSchema,
  scheduleItemSchema,
  setScheduleResultSchema,
} from "./contracts";
import type { z } from "zod";

// Thin RPC layer over the events/editions configuration commands (supabase/migrations/2026092810*).
// Rate-limiting (admin.mutation:cmd) and permission enforcement happen inside private.cfg_authorize
// in the database; this layer only encodes cursors, validates the result shape and logs.

type CreateEventBody = z.output<typeof createEventBodySchema>;

// ---- Events ----

export async function createEvent(supabase: SupabaseClient, body: CreateEventBody, idempotencyKey: string | null) {
  const result = await callRpc(supabase, "create_event", { p_input: body, p_idempotency_key: idempotencyKey }, eventSchema);
  logEvent("info", "event_created", { event_id: result.event_id });
  return result;
}

export async function updateEvent(supabase: SupabaseClient, eventId: string, body: JsonObject) {
  return callRpc(supabase, "update_event", { p_event_id: eventId, p_input: body }, eventSchema);
}

// ---- Events catalogue / Event read projection (P3-L) ----

export async function adminListEvents(
  supabase: SupabaseClient,
  filters: { status?: string; event_type_key?: string; search?: string; cursor?: string; limit?: number },
) {
  const after = filters.cursor ? decodeEventCursor(filters.cursor) : { created_at: null, event_id: null };
  const page = await callRpc(
    supabase,
    "admin_list_events",
    {
      p_status: filters.status ?? null,
      p_event_type_key: filters.event_type_key ?? null,
      p_search: filters.search ?? null,
      p_cursor_created_at: after.created_at,
      p_cursor_id: after.event_id,
      p_limit: filters.limit ?? 20,
    },
    adminEventListSchema,
  );
  return { items: page.items, nextCursor: page.next_cursor ? Buffer.from(JSON.stringify(page.next_cursor), "utf8").toString("base64url") : null };
}

function decodeEventCursor(cursor: string): { created_at: string | null; event_id: string | null } {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded && typeof decoded === "object" && "created_at" in decoded && "event_id" in decoded) {
      const { created_at, event_id } = decoded as { created_at: unknown; event_id: unknown };
      if (typeof created_at === "string" && typeof event_id === "string") return { created_at, event_id };
    }
  } catch {
    // falls through to the first page, like the Editions cursor
  }
  return { created_at: null, event_id: null };
}

export async function adminGetEvent(supabase: SupabaseClient, eventId: string) {
  return callRpc(supabase, "admin_get_event", { p_event_id: eventId }, adminEventSchema);
}

// ---- Admin list/editor ----

export async function adminListEditions(
  supabase: SupabaseClient,
  filters: {
    publication_state?: string;
    registration_state?: string;
    execution_state?: string;
    event_id?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  },
) {
  const after = filters.cursor ? decodeEditionCursor(filters.cursor) : { created_at: null, edition_id: null };
  const page = await callRpc(
    supabase,
    "admin_list_editions",
    {
      p_publication_state: filters.publication_state ?? null,
      p_registration_state: filters.registration_state ?? null,
      p_execution_state: filters.execution_state ?? null,
      p_event_id: filters.event_id ?? null,
      p_search: filters.search ?? null,
      p_cursor_created_at: after.created_at,
      p_cursor_id: after.edition_id,
      p_limit: filters.limit ?? 20,
    },
    adminEditionListSchema,
  );
  return { items: page.items, nextCursor: encodeEditionCursor(page.next_cursor) };
}

function decodeEditionCursor(cursor: string): { created_at: string | null; edition_id: string | null } {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded && typeof decoded === "object" && "created_at" in decoded && "edition_id" in decoded) {
      const { created_at, edition_id } = decoded as { created_at: unknown; edition_id: unknown };
      if (typeof created_at === "string" && typeof edition_id === "string") return { created_at, edition_id };
    }
  } catch {
    // falls through to invalid
  }
  return { created_at: null, edition_id: null };
}
function encodeEditionCursor(next: { created_at: string; edition_id: string } | null): string | null {
  return next ? Buffer.from(JSON.stringify(next), "utf8").toString("base64url") : null;
}

export async function adminGetEditionEditor(supabase: SupabaseClient, editionId: string) {
  return callRpc(supabase, "admin_get_edition_editor", { p_edition_id: editionId }, adminEditionEditorSchema);
}

// ---- Edition create/update/schedule ----

export async function createEdition(supabase: SupabaseClient, eventId: string, body: JsonObject, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "create_edition",
    { p_event_id: eventId, p_input: body, p_idempotency_key: idempotencyKey },
    editionSchema,
  );
  logEvent("info", "edition_created", { edition_id: result.edition_id });
  return result;
}

// P3-L optimistic concurrency. The optional `expected_updated_at` travels in the body but is never part of the command input: it is
// split off here and, when present, the command runs through the atomic guard (lock, compare, run in one transaction; stale ->
// 409 CONFLICT {reason: STALE_STATE}). Absent -> the plain command, exactly as before.
function splitPrecondition(body: JsonObject): { input: JsonObject; expected: string | null } {
  const { [EDITION_PRECONDITION_FIELD]: expected, ...input } = body;
  return { input, expected: typeof expected === "string" ? expected : null };
}

export async function updateEdition(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  const { input, expected } = splitPrecondition(body);
  if (expected === null) return callRpc(supabase, "update_edition", { p_edition_id: editionId, p_input: input }, editionUpdateResultSchema);
  return callRpc(
    supabase,
    "guarded_edition_command",
    { p_edition_id: editionId, p_command: "UPDATE", p_expected_updated_at: expected, p_input: input, p_idempotency_key: null },
    editionUpdateResultSchema,
  );
}

export async function setEditionSchedule(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  const { input, expected } = splitPrecondition(body);
  if (expected === null) return callRpc(supabase, "set_edition_schedule", { p_edition_id: editionId, p_input: input }, setScheduleResultSchema);
  return callRpc(
    supabase,
    "guarded_edition_command",
    { p_edition_id: editionId, p_command: "SET_SCHEDULE", p_expected_updated_at: expected, p_input: input, p_idempotency_key: null },
    setScheduleResultSchema,
  );
}

// ---- Edition transitions ----

const TRANSITION_COMMAND: Record<string, string> = {
  publish: "PUBLISH",
  hide: "HIDE",
  "open-registration": "OPEN_REGISTRATION",
  "pause-registration": "PAUSE_REGISTRATION",
  "resume-registration": "RESUME_REGISTRATION",
  "close-registration": "CLOSE_REGISTRATION",
  postpone: "POSTPONE",
  reschedule: "RESCHEDULE",
  cancel: "CANCEL",
  start: "START",
  finish: "FINISH",
};

const TRANSITION_FN: Record<string, string> = {
  publish: "publish_edition",
  hide: "hide_edition",
  "open-registration": "open_edition_registration",
  "pause-registration": "pause_edition_registration",
  "resume-registration": "resume_edition_registration",
  "close-registration": "close_edition_registration",
  postpone: "postpone_edition",
  reschedule: "reschedule_edition",
  cancel: "cancel_edition",
  start: "start_edition",
  finish: "finish_edition",
};

export async function transitionEdition(
  supabase: SupabaseClient,
  command: keyof typeof TRANSITION_FN,
  editionId: string,
  body: JsonObject,
  idempotencyKey: string | null,
) {
  const { input, expected } = splitPrecondition(body);
  const result =
    expected === null
      ? await callRpc(
          supabase,
          TRANSITION_FN[command],
          { p_edition_id: editionId, p_input: input, p_idempotency_key: idempotencyKey },
          editionTransitionResultSchema,
        )
      : await callRpc(
          supabase,
          "guarded_edition_command",
          {
            p_edition_id: editionId,
            p_command: TRANSITION_COMMAND[command],
            p_expected_updated_at: expected,
            p_input: input,
            p_idempotency_key: idempotencyKey,
          },
          editionTransitionResultSchema,
        );
  logEvent("info", "edition_transition", { edition_id: editionId, command });
  return result;
}

// ---- Modalities ----

export async function createModality(supabase: SupabaseClient, editionId: string, body: JsonObject, idempotencyKey: string | null) {
  return callRpc(supabase, "create_modality", { p_edition_id: editionId, p_input: body, p_idempotency_key: idempotencyKey }, modalitySchema);
}
export async function updateModality(supabase: SupabaseClient, modalityId: string, body: JsonObject) {
  return callRpc(supabase, "update_modality", { p_modality_id: modalityId, p_input: body }, modalitySchema);
}
export async function setModalityStatus(supabase: SupabaseClient, modalityId: string, body: JsonObject) {
  return callRpc(supabase, "set_modality_status", { p_modality_id: modalityId, p_input: body }, modalityStatusResultSchema);
}
export async function deleteModality(supabase: SupabaseClient, modalityId: string) {
  return callRpc(supabase, "delete_modality", { p_modality_id: modalityId }, deletedModalityResultSchema);
}
export async function setModalityCapacity(supabase: SupabaseClient, modalityId: string, body: JsonObject) {
  return callRpc(supabase, "set_modality_capacity", { p_modality_id: modalityId, p_input: body }, modalityCapacityResultSchema);
}
export async function setEditionGlobalCapacity(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  return callRpc(supabase, "set_edition_global_capacity", { p_edition_id: editionId, p_input: body }, globalCapacityResultSchema);
}

// ---- Price offers ----

export async function createPriceOffer(supabase: SupabaseClient, modalityId: string, body: JsonObject, idempotencyKey: string | null) {
  return callRpc(
    supabase,
    "create_price_offer",
    { p_modality_id: modalityId, p_input: body, p_idempotency_key: idempotencyKey },
    priceOfferResultSchema,
  );
}
export async function updatePriceOffer(supabase: SupabaseClient, priceOfferId: string, body: JsonObject) {
  return callRpc(supabase, "update_price_offer", { p_price_offer_id: priceOfferId, p_input: body }, priceOfferResultSchema);
}

// ---- Categories ----

export async function createCategory(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  return callRpc(supabase, "create_category", { p_edition_id: editionId, p_input: body }, categorySchema);
}
export async function updateCategory(supabase: SupabaseClient, categoryId: string, body: JsonObject) {
  return callRpc(supabase, "update_category", { p_category_id: categoryId, p_input: body }, categorySchema);
}

// ---- Registration forms ----

export async function createRegistrationForm(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  return callRpc(supabase, "create_registration_form", { p_edition_id: editionId, p_input: body }, registrationFormSchema);
}
export async function replaceRegistrationFormFields(supabase: SupabaseClient, formId: string, body: JsonObject) {
  return callRpc(supabase, "replace_registration_form_fields", { p_registration_form_id: formId, p_input: body }, registrationFormSchema);
}
export async function publishRegistrationForm(supabase: SupabaseClient, formId: string, idempotencyKey: string | null) {
  return callRpc(
    supabase,
    "publish_registration_form",
    { p_registration_form_id: formId, p_idempotency_key: idempotencyKey },
    formPublishResultSchema,
  );
}
export async function deleteRegistrationForm(supabase: SupabaseClient, formId: string) {
  return callRpc(supabase, "delete_registration_form", { p_registration_form_id: formId }, deletedResultSchema("registration_form_id"));
}

// ---- Locations ----

export async function createEditionLocation(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  return callRpc(supabase, "create_edition_location", { p_edition_id: editionId, p_input: body }, locationSchema);
}
export async function updateEditionLocation(supabase: SupabaseClient, locationId: string, body: JsonObject) {
  return callRpc(supabase, "update_edition_location", { p_location_id: locationId, p_input: body }, locationSchema);
}
export async function deleteEditionLocation(supabase: SupabaseClient, locationId: string) {
  return callRpc(supabase, "delete_edition_location", { p_location_id: locationId }, deletedLocationResultSchema);
}

// ---- Agenda (schedule items) ----

export async function createScheduleItem(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  return callRpc(supabase, "create_schedule_item", { p_edition_id: editionId, p_input: body }, scheduleItemSchema);
}
export async function updateScheduleItem(supabase: SupabaseClient, itemId: string, body: JsonObject) {
  return callRpc(supabase, "update_schedule_item", { p_item_id: itemId, p_input: body }, scheduleItemSchema);
}
export async function deleteScheduleItem(supabase: SupabaseClient, itemId: string) {
  return callRpc(supabase, "delete_schedule_item", { p_item_id: itemId }, deletedScheduleItemResultSchema);
}

// ---- Content blocks ----

export async function createContentBlock(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  return callRpc(supabase, "create_content_block", { p_edition_id: editionId, p_input: body }, contentBlockSchema);
}
export async function updateContentBlock(supabase: SupabaseClient, blockId: string, body: JsonObject) {
  return callRpc(supabase, "update_content_block", { p_block_id: blockId, p_input: body }, contentBlockSchema);
}
export async function deleteContentBlock(supabase: SupabaseClient, blockId: string) {
  return callRpc(supabase, "delete_content_block", { p_block_id: blockId }, deletedContentBlockResultSchema);
}

// ---- Kits ----

export async function createKitDefinition(supabase: SupabaseClient, editionId: string, body: JsonObject) {
  return callRpc(supabase, "create_kit_definition", { p_edition_id: editionId, p_input: body }, kitDefinitionSchema);
}
export async function updateKitDefinition(supabase: SupabaseClient, kitDefinitionId: string, body: JsonObject) {
  return callRpc(supabase, "update_kit_definition", { p_kit_definition_id: kitDefinitionId, p_input: body }, kitDefinitionSchema);
}
export async function createKitVariant(supabase: SupabaseClient, kitDefinitionId: string, body: JsonObject) {
  return callRpc(supabase, "create_kit_variant", { p_kit_definition_id: kitDefinitionId, p_input: body }, kitDefinitionSchema);
}
export async function updateKitVariant(supabase: SupabaseClient, kitVariantId: string, body: JsonObject) {
  return callRpc(supabase, "update_kit_variant", { p_kit_variant_id: kitVariantId, p_input: body }, kitVariantResultSchema);
}

// ---- Platform settings ----

export async function adminGetPlatformSettings(supabase: SupabaseClient) {
  return callRpc(supabase, "admin_get_platform_settings", {}, platformSettingsSchema);
}
export async function updatePlatformSettings(supabase: SupabaseClient, body: JsonObject) {
  return callRpc(supabase, "update_platform_settings", { p_input: body }, platformSettingsSchema);
}

// ---- Anti-hoarding policy (P3-D migration 721 RPCs; ADMIN global, audited) ----

export async function adminGetAntiHoardingPolicy(supabase: SupabaseClient) {
  return callRpc(supabase, "admin_get_anti_hoarding_policy", {}, antiHoardingPolicySchema);
}
export async function updateAntiHoardingPolicy(supabase: SupabaseClient, body: JsonObject, idempotencyKey: string) {
  const result = await callRpc(
    supabase,
    "update_anti_hoarding_policy_idempotent",
    { p_input: body, p_idempotency_key: idempotencyKey },
    antiHoardingPolicySchema,
  );
  logEvent("info", "anti_hoarding_policy_updated", { field_count: Object.keys(body).length });
  return result;
}

// ---- Legal documents (Master §123, §165) ----

export async function adminListLegalDocuments(supabase: SupabaseClient) {
  return callRpc(supabase, "admin_list_legal_documents", {}, legalDocumentListSchema);
}
export async function adminGetLegalDocumentVersion(supabase: SupabaseClient, versionId: string) {
  return callRpc(supabase, "admin_get_legal_document_version", { p_legal_document_version_id: versionId }, legalVersionSchema);
}
export async function createLegalDocument(supabase: SupabaseClient, body: JsonObject) {
  return callRpc(supabase, "create_legal_document", { p_input: body }, legalDocumentSchema);
}
export async function createLegalDocumentVersion(supabase: SupabaseClient, documentId: string, body: JsonObject) {
  return callRpc(supabase, "create_legal_document_version", { p_legal_document_id: documentId, p_input: body }, legalVersionSchema);
}
export async function updateLegalDocumentVersion(supabase: SupabaseClient, versionId: string, body: JsonObject) {
  return callRpc(supabase, "update_legal_document_version", { p_legal_document_version_id: versionId, p_input: body }, legalVersionSchema);
}
export async function publishLegalDocumentVersion(supabase: SupabaseClient, versionId: string, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "publish_legal_document_version",
    { p_legal_document_version_id: versionId, p_idempotency_key: idempotencyKey },
    legalVersionPublishResultSchema,
  );
  logEvent("info", "legal_document_version_published", { legal_document_version_id: versionId });
  return result;
}

// Public (anon/authenticated): GET /api/v1/legal/:documentKey. NULL RPC result means "no ACTIVE
// document with a PUBLISHED version" — the route maps that to a 404 (Master §165).
export async function getPublicLegalDocument(supabase: SupabaseClient, documentKey: string) {
  const { data, error, status } = await supabase.rpc("get_legal_document", { p_document_key: documentKey });
  if (error) throw mapRpcError("get_legal_document", error, status);
  if (data === null) return null;
  return publicLegalDocumentSchema.parse(data);
}
