import "server-only";
import { z } from "zod";
import { isPublicMediaKey } from "@/lib/shared/media-url";

// Output schemas mirror the jsonb projections in supabase/migrations/20260928100[0-4]00_30[0-4]_*.sql
// exactly (private.*_projection): an unexpected key fails closed as INTERNAL_ERROR instead of
// reaching the client (SEC-120). Input schemas are intentionally thinner than the SQL `cfg_*`
// validators: they reject the wrong shape/type at the edge (unknown fields, gross bounds) while the
// database remains the single source of truth for business rules (ADR-001 §2/§9).

const id = z.guid();
const timestamp = z.string().min(1);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

// ---- Eligibility rules v1 (KERNEL_READY.md) ----

export const eligibilityRulesSchema = z.strictObject({
  min_age: z.int().min(15).max(100).optional(),
  max_age: z.int().min(15).max(100).optional(),
  sex_codes: z.array(z.enum(["F", "M", "X"])).min(1).max(3).optional(),
});

// ---- Schedule input (create_edition.schedule / RESCHEDULE) ----

export const scheduleInputSchema = z.strictObject({
  local_date: dateStr,
  local_start_time: timeStr.optional(),
  local_end_time: timeStr.optional(),
});

const scheduleRevisionSchema = z
  .strictObject({
    edition_schedule_revision_id: id,
    revision: z.int(),
    schedule_state: z.enum(["POSTPONED_NO_NEW_DATE", "DATE_CONFIRMED_TIME_PENDING", "DATE_TIME_CONFIRMED"]),
    local_date: dateStr.nullable(),
    local_start_time: timeStr.nullable(),
    local_end_time: timeStr.nullable(),
    timezone: z.string(),
    effective_start_at: timestamp.nullable(),
    effective_end_at: timestamp.nullable(),
    created_at: timestamp,
  })
  .nullable();

// ---- Event ----

export const eventSchema = z.strictObject({
  event_id: id,
  name: z.string(),
  canonical_key: z.string(),
  status: z.string(),
  event_type_key: z.string(),
  event_type_name: z.string(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const createEventBodySchema = z.strictObject({
  event_type_key: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(160),
  canonical_key: z.string().trim().min(1).max(160),
});

export const updateEventBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(160).optional(),
  event_type_key: z.string().trim().min(1).max(64).optional(),
});

// ---- Edition ----

export const editionSchema = z.strictObject({
  edition_id: id,
  event_id: id,
  slug: z.string(),
  name: z.string(),
  publication_state: z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]),
  registration_state: z.enum(["NOT_OPEN", "OPEN", "PAUSED", "CLOSED"]),
  execution_state: z.enum(["SCHEDULED", "POSTPONED", "IN_PROGRESS", "FINISHED", "CANCELED"]),
  closure_state: z.string(),
  registration_mode: z.enum(["FREE", "EXTERNAL_WHATSAPP"]),
  timezone: z.string(),
  registration_open_at: timestamp.nullable(),
  registration_close_at: timestamp,
  global_capacity: z.int().nullable(),
  city: z.string(),
  state_region: z.string(),
  country_code: z.string(),
  primary_location_id: id.nullable(),
  whatsapp_phone_e164: z.string().nullable(),
  is_benefit_event: z.boolean(),
  published_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
  schedule: scheduleRevisionSchema,
});

const editionUpdateResultSchema = editionSchema.extend({ changed_fields: z.array(z.string()) });

export const createEditionBodySchema = z.strictObject({
  slug: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  registration_mode: z.enum(["FREE", "EXTERNAL_WHATSAPP"]),
  timezone: z.string().trim().min(1).max(64).optional(),
  city: z.string().trim().min(1).max(120),
  state_region: z.string().trim().min(1).max(120),
  country_code: z.string().length(2).optional(),
  registration_open_at: z.iso.datetime({ offset: true }).optional(),
  registration_close_at: z.iso.datetime({ offset: true }).optional(),
  global_capacity: z.int().min(0).max(1000000).optional(),
  whatsapp_phone_e164: z.e164().optional(),
  is_benefit_event: z.boolean().optional(),
  schedule: scheduleInputSchema.optional(),
});

// P3-L optimistic concurrency: the Edition `updated_at` the client last read (editor projection `edition.updated_at`). Optional so
// callers that do not send it keep the previous last-write-wins behaviour; when present and stale the command refuses with
// 409 CONFLICT {reason: "STALE_STATE"} and changes nothing. Pass the value back exactly as received (never reformat it).
export const EDITION_PRECONDITION_FIELD = "expected_updated_at";
const editionPrecondition = { expected_updated_at: z.iso.datetime({ offset: true }).optional() };

export const updateEditionBodySchema = z.strictObject({
  ...editionPrecondition,
  name: z.string().trim().min(1).max(160).optional(),
  slug: z.string().trim().min(1).max(160).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  state_region: z.string().trim().min(1).max(120).optional(),
  country_code: z.string().length(2).optional(),
  registration_mode: z.enum(["FREE", "EXTERNAL_WHATSAPP"]).optional(),
  registration_open_at: z.iso.datetime({ offset: true }).nullable().optional(),
  registration_close_at: z.iso.datetime({ offset: true }).optional(),
  whatsapp_phone_e164: z.e164().nullable().optional(),
  is_benefit_event: z.boolean().optional(),
  primary_location_id: id.nullable().optional(),
});

export const setEditionScheduleBodySchema = z.strictObject({
  ...editionPrecondition,
  local_date: dateStr,
  local_start_time: timeStr.optional(),
  local_end_time: timeStr.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
const setScheduleResultSchema = z.strictObject({ edition: editionSchema, changed: z.boolean(), announced: z.boolean().optional() });

export const editionTransitionResultSchema = z.strictObject({ edition: editionSchema }).catchall(z.unknown());

export const publishEditionBodySchema = z.strictObject({ ...editionPrecondition });
export const hideEditionBodySchema = z.strictObject({ ...editionPrecondition, reason: z.string().trim().min(1).max(500) });
export const openRegistrationBodySchema = z.strictObject({ ...editionPrecondition });
export const pauseRegistrationBodySchema = z.strictObject({ ...editionPrecondition, reason: z.string().trim().min(1).max(500) });
export const resumeRegistrationBodySchema = z.strictObject({ ...editionPrecondition });
export const closeRegistrationBodySchema = z.strictObject({ ...editionPrecondition, reason: z.string().trim().min(1).max(500) });
export const postponeEditionBodySchema = z.strictObject({
  ...editionPrecondition,
  reason: z.string().trim().min(1).max(500),
  registration_action: z.enum(["PAUSE", "CLOSE"]).optional(),
});
export const rescheduleEditionBodySchema = z.strictObject({
  ...editionPrecondition,
  reason: z.string().trim().min(1).max(500),
  local_date: dateStr,
  local_start_time: timeStr.optional(),
  local_end_time: timeStr.optional(),
  registration_close_at: z.iso.datetime({ offset: true }).optional(),
});
export const cancelEditionBodySchema = z.strictObject({ ...editionPrecondition, reason: z.string().trim().min(1).max(500) });
export const startEditionBodySchema = z.strictObject({ ...editionPrecondition });
export const finishEditionBodySchema = z.strictObject({ ...editionPrecondition });

// ---- Modality ----

export const modalitySchema = z.strictObject({
  modality_id: id,
  edition_id: id,
  key: z.string(),
  name: z.string(),
  official_distance_m: z.int().nullable(),
  generates_distance_credit: z.boolean(),
  local_start_time: timeStr.nullable(),
  status: z.enum(["ACTIVE", "CLOSED", "CANCELED"]),
  sort_order: z.int(),
  eligibility_rule_version: z.int(),
  eligibility_rules: eligibilityRulesSchema,
  effective_capacity: z.int().nullable(),
  category_ids: z.array(id),
  created_at: timestamp,
  updated_at: timestamp,
});

export const createModalityBodySchema = z.strictObject({
  key: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  official_distance_m: z.int().min(1).max(1000000).optional(),
  generates_distance_credit: z.boolean().optional(),
  local_start_time: timeStr.optional(),
  sort_order: z.int().min(0).max(10000).optional(),
  eligibility_rules: eligibilityRulesSchema.optional(),
  effective_capacity: z.int().min(0).max(1000000).optional(),
});

export const updateModalityBodySchema = z.strictObject({
  key: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  official_distance_m: z.int().min(1).max(1000000).optional(),
  generates_distance_credit: z.boolean().optional(),
  local_start_time: timeStr.optional(),
  sort_order: z.int().min(0).max(10000).optional(),
  eligibility_rules: eligibilityRulesSchema.optional(),
});

export const setModalityStatusBodySchema = z.strictObject({
  status: z.enum(["ACTIVE", "CLOSED", "CANCELED"]),
  reason: z.string().trim().min(1).max(500).optional(),
});

const warningsSchema = z.array(z.record(z.string(), z.unknown()));

export const modalityStatusResultSchema = z.strictObject({ modality: modalitySchema, warnings: warningsSchema });
export const deletedResultSchema = (key: string) => z.strictObject({ [key]: id, deleted: z.literal(true) });
// Delete commands whose SQL also returns edition_id (20260928110200_312), so the route layer can
// fire EditionContentChanged without an extra fetch (T31c-cache-invalidation). Explicit shapes, not
// a `deletedResultSchema(key).extend(...)` factory: a computed `[key]: id` object literal with a
// non-literal `key: string` widens every property's inferred TS type (including edition_id) to the
// union of all value types, because TS reads the computed key as an index signature.
export const deletedModalityResultSchema = z.strictObject({ modality_id: id, deleted: z.literal(true), edition_id: id });
export const deletedLocationResultSchema = z.strictObject({ edition_location_id: id, deleted: z.literal(true), edition_id: id });
export const deletedScheduleItemResultSchema = z.strictObject({ edition_schedule_item_id: id, deleted: z.literal(true), edition_id: id });
export const deletedContentBlockResultSchema = z.strictObject({ event_content_block_id: id, deleted: z.literal(true), edition_id: id });

export const setModalityCapacityBodySchema = z.strictObject({
  effective_capacity: z.int().min(0).max(1000000).nullable(),
  acknowledge_below_occupation: z.boolean().optional(),
});
export const setGlobalCapacityBodySchema = z.strictObject({
  global_capacity: z.int().min(0).max(1000000).nullable(),
  acknowledge_below_occupation: z.boolean().optional(),
});

const availabilitySchema = z.record(z.string(), z.unknown());

export const modalityCapacityResultSchema = z.strictObject({
  modality: modalitySchema,
  availability: availabilitySchema,
  warnings: warningsSchema,
});
export const globalCapacityResultSchema = z.strictObject({
  edition: editionSchema,
  availability: availabilitySchema,
  warnings: warningsSchema,
});

// ---- Price offers ----

export const priceOfferSchema = z.strictObject({
  price_offer_id: id,
  modality_id: id,
  // T31c-cache-invalidation: lets the route layer build the `edition:<id>` cache tag (PriceOfferChanged)
  // without an extra fetch (supabase/migrations/20260928110200_312_cache_invalidation_support.sql).
  edition_id: id,
  name: z.string(),
  amount_minor: z.number().int(),
  currency: z.string(),
  starts_at: timestamp.nullable(),
  ends_at: timestamp.nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "EXPIRED"]),
  priority: z.int(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const priceOfferResultSchema = z.strictObject({ price_offer: priceOfferSchema, warnings: warningsSchema });

export const createPriceOfferBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  amount_minor: z.int().min(0).max(100000000),
  currency: z.string().length(3).optional(),
  starts_at: z.iso.datetime({ offset: true }).optional(),
  ends_at: z.iso.datetime({ offset: true }).optional(),
  priority: z.int().min(-1000).max(1000).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const updatePriceOfferBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  amount_minor: z.int().min(0).max(100000000).optional(),
  currency: z.string().length(3).optional(),
  starts_at: z.iso.datetime({ offset: true }).nullable().optional(),
  ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
  priority: z.int().min(-1000).max(1000).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "EXPIRED"]).optional(),
});

// ---- Categories ----

export const categorySchema = z.strictObject({
  category_id: id,
  edition_id: id,
  key: z.string(),
  name: z.string(),
  assignment_mode: z.enum(["USER_SELECTS", "SYSTEM_DERIVES"]),
  eligibility_rule: eligibilityRulesSchema,
  active: z.boolean(),
  sort_order: z.int(),
  modality_ids: z.array(id),
});

const categoryFields = {
  key: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  assignment_mode: z.enum(["USER_SELECTS", "SYSTEM_DERIVES"]),
  eligibility_rule: eligibilityRulesSchema.optional(),
  active: z.boolean().optional(),
  sort_order: z.int().min(0).max(10000).optional(),
  modality_ids: z.array(id).max(100).optional(),
};
export const createCategoryBodySchema = z.strictObject(categoryFields);
export const updateCategoryBodySchema = z.strictObject({
  key: categoryFields.key.optional(),
  name: categoryFields.name.optional(),
  assignment_mode: categoryFields.assignment_mode.optional(),
  eligibility_rule: categoryFields.eligibility_rule,
  active: categoryFields.active,
  sort_order: categoryFields.sort_order,
  modality_ids: categoryFields.modality_ids,
});

// ---- Registration forms ----

const formFieldSchema = z.strictObject({
  field_key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().trim().min(1).max(160),
  field_type: z.enum(["TEXT", "TEXTAREA", "SELECT", "MULTISELECT", "BOOLEAN", "DATE", "NUMBER"]),
  required: z.boolean().optional(),
  validation_config: z.record(z.string(), z.unknown()).optional(),
  options_config: z.record(z.string(), z.unknown()).optional(),
  sensitivity: z.enum(["NORMAL", "SENSITIVE"]).optional(),
  sort_order: z.int().min(0).max(10000).optional(),
});

const formFieldViewSchema = z.strictObject({
  registration_form_field_id: id,
  field_key: z.string(),
  label: z.string(),
  field_type: z.enum(["TEXT", "TEXTAREA", "SELECT", "MULTISELECT", "BOOLEAN", "DATE", "NUMBER"]),
  required: z.boolean(),
  validation_config: z.record(z.string(), z.unknown()),
  options_config: z.record(z.string(), z.unknown()),
  sensitivity: z.enum(["NORMAL", "SENSITIVE"]),
  sort_order: z.int(),
});

export const registrationFormSchema = z.strictObject({
  registration_form_id: id,
  edition_id: id,
  modality_id: id.nullable(),
  version: z.int(),
  status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"]),
  created_at: timestamp,
  published_at: timestamp.nullable(),
  fields: z.array(formFieldViewSchema),
});
const formPublishResultSchema = registrationFormSchema.extend({ superseded_registration_form_id: id.nullable() });

export const createRegistrationFormBodySchema = z.strictObject({
  modality_id: id.optional(),
  copy_published_fields: z.boolean().optional(),
  fields: z.array(formFieldSchema).max(50).optional(),
});
export const replaceFormFieldsBodySchema = z.strictObject({ fields: z.array(formFieldSchema).max(50) });

// ---- Locations ----

export const locationSchema = z.strictObject({
  edition_location_id: id,
  edition_id: id,
  location_type: z.enum(["DISCOVERY", "VENUE", "START", "FINISH", "MEETING_POINT", "PARKING", "KIT_PICKUP", "OTHER"]),
  name: z.string(),
  address_line: z.string().nullable(),
  city: z.string().nullable(),
  state_region: z.string().nullable(),
  country_code: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  is_primary: z.boolean(),
  sort_order: z.int(),
});

const locationFields = {
  location_type: z.enum(["DISCOVERY", "VENUE", "START", "FINISH", "MEETING_POINT", "PARKING", "KIT_PICKUP", "OTHER"]),
  name: z.string().trim().min(1).max(160),
  address_line: z.string().trim().min(1).max(300).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  state_region: z.string().trim().min(1).max(120).optional(),
  country_code: z.string().length(2).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  is_primary: z.boolean().optional(),
  sort_order: z.int().min(0).max(10000).optional(),
};
export const createLocationBodySchema = z.strictObject(locationFields);
// P3-M: an optional value is cleared by sending it as null; an absent key means unchanged. Required values (location_type, name, is_primary,
// sort_order) stay non-nullable. Coordinates are one pair: send both, or null on either one to clear the whole point (a lone number is
// refused by the database with VALIDATION_ERROR on longitude).
export const updateLocationBodySchema = z.strictObject({
  location_type: locationFields.location_type.optional(),
  name: locationFields.name.optional(),
  address_line: locationFields.address_line.nullable(),
  city: locationFields.city.nullable(),
  state_region: locationFields.state_region.nullable(),
  country_code: locationFields.country_code.nullable(),
  latitude: locationFields.latitude.nullable(),
  longitude: locationFields.longitude.nullable(),
  is_primary: locationFields.is_primary,
  sort_order: locationFields.sort_order,
});

// ---- Agenda (schedule items) ----

export const scheduleItemSchema = z.strictObject({
  edition_schedule_item_id: id,
  edition_id: id,
  modality_id: id.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  local_date: dateStr,
  local_start_time: timeStr.nullable(),
  local_end_time: timeStr.nullable(),
  location_id: id.nullable(),
  sort_order: z.int(),
  status: z.enum(["ACTIVE", "CANCELED"]),
});

const scheduleItemFields = {
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000).optional(),
  local_date: dateStr,
  local_start_time: timeStr.optional(),
  local_end_time: timeStr.optional(),
  modality_id: id.optional(),
  location_id: id.optional(),
  sort_order: z.int().min(0).max(10000).optional(),
  status: z.enum(["ACTIVE", "CANCELED"]).optional(),
};
export const createScheduleItemBodySchema = z.strictObject(scheduleItemFields);
// P3-M: description, times, modality and location are cleared with null (absent = unchanged); title, local_date, sort_order and status
// stay non-nullable. An end time without a start time is refused by the database (must_follow_start), so clear both in one PATCH.
export const updateScheduleItemBodySchema = z.strictObject({
  title: scheduleItemFields.title.optional(),
  description: scheduleItemFields.description.nullable(),
  local_date: scheduleItemFields.local_date.optional(),
  local_start_time: scheduleItemFields.local_start_time.nullable(),
  local_end_time: scheduleItemFields.local_end_time.nullable(),
  modality_id: scheduleItemFields.modality_id.nullable(),
  location_id: scheduleItemFields.location_id.nullable(),
  sort_order: scheduleItemFields.sort_order,
  status: scheduleItemFields.status,
});

// ---- Content blocks (SEC-061: markdown text only, no HTML; https/mailto/tel/relative links) ----

export const contentBlockSchema = z.strictObject({
  event_content_block_id: id,
  edition_id: id,
  modality_id: id.nullable(),
  block_type: z.enum(["RICH_TEXT", "CALLOUT", "IMAGE", "GALLERY", "FAQ", "DOCUMENT_LINK", "SPONSOR_GROUP", "CUSTOM_SECTION"]),
  position: z.int(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  payload: z.record(z.string(), z.unknown()),
  created_at: timestamp,
  updated_at: timestamp,
});

// Shape only: which keys are required per block_type is enforced by private.cfg_content_payload.
const contentBlockPayloadSchema = z.record(z.string(), z.unknown());

export const createContentBlockBodySchema = z.strictObject({
  block_type: z.enum(["RICH_TEXT", "CALLOUT", "IMAGE", "GALLERY", "FAQ", "DOCUMENT_LINK", "SPONSOR_GROUP", "CUSTOM_SECTION"]),
  modality_id: id.optional(),
  position: z.int().min(0).max(10000).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  payload: contentBlockPayloadSchema,
});
export const updateContentBlockBodySchema = z.strictObject({
  modality_id: id.nullable().optional(),
  position: z.int().min(0).max(10000).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  payload: contentBlockPayloadSchema.optional(),
});

// ---- Kits ----

const kitVariantSchema = z.strictObject({
  kit_variant_id: id,
  variant_key: z.string(),
  label: z.string(),
  capacity: z.int().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  allocated: z.int(),
});

export const kitDefinitionSchema = z.strictObject({
  kit_definition_id: id,
  edition_id: id,
  name: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  pickup_start_at: timestamp.nullable(),
  pickup_end_at: timestamp.nullable(),
  instructions: z.string().nullable(),
  variants: z.array(kitVariantSchema),
});
export const kitVariantResultSchema = z.strictObject({ kit: kitDefinitionSchema, warnings: warningsSchema });

const kitVariantInputFields = {
  variant_key: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/),
  label: z.string().trim().min(1).max(80),
  capacity: z.int().min(0).max(1000000).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
};
const kitVariantInputSchema = z.strictObject(kitVariantInputFields);

export const createKitDefinitionBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  pickup_start_at: z.iso.datetime({ offset: true }).optional(),
  pickup_end_at: z.iso.datetime({ offset: true }).optional(),
  instructions: z.string().trim().min(1).max(2000).optional(),
  variants: z.array(kitVariantInputSchema).max(50).optional(),
});
export const updateKitDefinitionBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  pickup_start_at: z.iso.datetime({ offset: true }).nullable().optional(),
  pickup_end_at: z.iso.datetime({ offset: true }).nullable().optional(),
  instructions: z.string().trim().min(1).max(2000).nullable().optional(),
});
export const createKitVariantBodySchema = kitVariantInputSchema;
export const updateKitVariantBodySchema = z.strictObject({
  label: kitVariantInputFields.label.optional(),
  capacity: kitVariantInputFields.capacity.nullable(),
  status: kitVariantInputFields.status,
  acknowledge_below_allocation: z.boolean().optional(),
});

// ---- Platform settings (Master §155) ----

export const platformSettingsSchema = z.strictObject({
  timezone: z.string(),
  default_whatsapp_phone_e164: z.string().nullable(),
  registration_hold_minutes: z.int(),
  registration_close_offset_minutes: z.int(),
  email_otp_expiry_seconds: z.int(),
  availability_low_threshold_percent: z.number().nullable(),
  updated_at: timestamp.nullable(),
  updated_by_staff_id: id.nullable(),
  // Staff-safe label (P3-P, private.staff_display_label): null while nobody has updated the settings; viewer-dependent.
  updated_by_staff_label: z.string().nullable().optional(),
});

export const updatePlatformSettingsBodySchema = z.strictObject({
  timezone: z.string().trim().min(1).max(64).optional(),
  default_whatsapp_phone_e164: z.e164().nullable().optional(),
  registration_hold_minutes: z.int().min(1).max(10080).optional(),
  registration_close_offset_minutes: z.int().min(0).max(43200).optional(),
  email_otp_expiry_seconds: z.int().min(60).max(3600).optional(),
  availability_low_threshold_percent: z.number().min(0.01).max(99.99).nullable().optional(),
});

// ---- Legal documents (Master §123, §165) ----

const legalVersionRefSchema = z.strictObject({ legal_document_version_id: id, version: z.int(), published_at: timestamp.nullable() });

export const legalDocumentSchema = z.strictObject({
  legal_document_id: id,
  document_key: z.string(),
  document_type: z.enum(["TERMS_OF_SERVICE", "PRIVACY_NOTICE", "SPORT_WAIVER", "MINOR_TERMS", "EVENT_RULES"]),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  created_at: timestamp,
  edition_id: id.nullable(),
  current_version: legalVersionRefSchema.nullable(),
  versions: z.array(
    z.strictObject({
      legal_document_version_id: id,
      version: z.int(),
      status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"]),
      published_at: timestamp.nullable(),
      created_at: timestamp,
      has_content: z.boolean(),
      public_asset_key: z.string().nullable(),
    }),
  ),
});

export const legalVersionSchema = z.strictObject({
  legal_document_version_id: id,
  legal_document_id: id,
  document_key: z.string(),
  document_type: z.string(),
  version: z.int(),
  status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"]),
  content_markdown: z.string().nullable(),
  public_asset_key: z.string().nullable(),
  published_at: timestamp.nullable(),
  created_at: timestamp,
});
const legalVersionPublishResultSchema = legalVersionSchema
  .omit({ content_markdown: true })
  .extend({ superseded_legal_document_version_id: id.nullable() });

export const legalDocumentListSchema = z.array(legalDocumentSchema);

export const createLegalDocumentBodySchema = z.strictObject({
  document_type: z.enum(["TERMS_OF_SERVICE", "PRIVACY_NOTICE", "SPORT_WAIVER", "MINOR_TERMS", "EVENT_RULES"]),
  document_key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional(),
  edition_id: id.optional(),
});
export const createLegalVersionBodySchema = z.strictObject({
  content_markdown: z.string().trim().min(1).max(200000).optional(),
  public_asset_key: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/)
    .optional(),
});
export const updateLegalVersionBodySchema = createLegalVersionBodySchema;

export const publicLegalDocumentSchema = z.strictObject({
  document_key: z.string(),
  document_type: z.string(),
  legal_document_version_id: id,
  version: z.int(),
  content_markdown: z.string().nullable(),
  public_asset_key: z.string().nullable(),
  published_at: timestamp,
});

// ---- Admin list/editor (Master §169) ----

const editionSummarySchema = z.strictObject({
  edition_id: id,
  event_id: id,
  event_name: z.string(),
  slug: z.string(),
  name: z.string(),
  publication_state: z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]),
  registration_state: z.enum(["NOT_OPEN", "OPEN", "PAUSED", "CLOSED"]),
  execution_state: z.enum(["SCHEDULED", "POSTPONED", "IN_PROGRESS", "FINISHED", "CANCELED"]),
  closure_state: z.string(),
  city: z.string(),
  country_code: z.string(),
  created_at: timestamp,
  sport_date: dateStr.nullable(),
});

const editionListCursorSchema = z.strictObject({ created_at: timestamp, edition_id: id }).nullable();

export const adminEditionListSchema = z.strictObject({
  items: z.array(editionSummarySchema),
  next_cursor: editionListCursorSchema,
});

export const adminEditionListQuerySchema = z.strictObject({
  publication_state: z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]).optional(),
  registration_state: z.enum(["NOT_OPEN", "OPEN", "PAUSED", "CLOSED"]).optional(),
  execution_state: z.enum(["SCHEDULED", "POSTPONED", "IN_PROGRESS", "FINISHED", "CANCELED"]).optional(),
  event_id: id.optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const readinessCheckSchema = z.strictObject({ code: z.string(), ok: z.boolean(), detail: z.unknown().optional() });
const readinessSchema = z.strictObject({ ready: z.boolean(), checks: z.array(readinessCheckSchema) });

const modalityWithPricesSchema = modalitySchema.extend({ price_offers: z.array(priceOfferSchema) });

export const adminEditionEditorSchema = z.strictObject({
  edition: editionSchema,
  availability: availabilitySchema,
  readiness: z.strictObject({ publication: readinessSchema, registration: readinessSchema }),
  modalities: z.array(modalityWithPricesSchema),
  categories: z.array(categorySchema),
  registration_forms: z.array(registrationFormSchema),
  locations: z.array(locationSchema),
  agenda: z.array(scheduleItemSchema),
  content_blocks: z.array(contentBlockSchema),
  kits: z.array(kitDefinitionSchema),
});

// ---- Events catalogue and Event read projection (P3-L, Master 27/169) ----

const eventListItemSchema = eventSchema.extend({ edition_count: z.int().min(0), latest_edition_created_at: timestamp.nullable() });

export const adminEventListSchema = z.strictObject({
  items: z.array(eventListItemSchema),
  next_cursor: z.strictObject({ created_at: timestamp, event_id: id }).nullable(),
});

export const adminEventListQuerySchema = z.strictObject({
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  event_type_key: z.string().trim().min(1).max(64).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const adminEventSchema = eventSchema.extend({
  edition_count: z.int().min(0),
  editions: z.array(
    z.strictObject({
      edition_id: id,
      slug: z.string(),
      name: z.string(),
      publication_state: z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]),
      registration_state: z.enum(["NOT_OPEN", "OPEN", "PAUSED", "CLOSED"]),
      execution_state: z.enum(["SCHEDULED", "POSTPONED", "IN_PROGRESS", "FINISHED", "CANCELED"]),
      sport_date: dateStr.nullable(),
      created_at: timestamp,
      updated_at: timestamp,
    }),
  ),
});

// ---- Schedule revision history (P3-M, Master 29) ----

export const scheduleRevisionHistoryItemSchema = z.strictObject({
  edition_schedule_revision_id: id,
  revision: z.int().min(1),
  schedule_state: z.enum(["POSTPONED_NO_NEW_DATE", "DATE_CONFIRMED_TIME_PENDING", "DATE_TIME_CONFIRMED"]),
  local_date: dateStr.nullable(),
  local_start_time: timeStr.nullable(),
  local_end_time: timeStr.nullable(),
  timezone: z.string(),
  effective_start_at: timestamp.nullable(),
  effective_end_at: timestamp.nullable(),
  reason: z.string().nullable(),
  created_at: timestamp,
  superseded_at: timestamp.nullable(),
  is_current: z.boolean(),
  // Opaque staff_member_id plus a staff-safe label (P3-O, private.staff_display_label): "First L." for ADMIN/OPERATOR viewers who have a profile
  // name, otherwise "Staff #abc123". Never an email, an auth id or the full name.
  created_by_staff_id: id,
  created_by_staff_label: z.string(),
});

export const scheduleRevisionHistorySchema = z.strictObject({
  items: z.array(scheduleRevisionHistoryItemSchema),
  total: z.int().min(0),
  next_cursor: z.strictObject({ revision: z.int().min(1) }).nullable(),
});

export const scheduleRevisionHistoryQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ---- Media asset references (P3-M, Master 52) ----

const mediaStatus = z.enum(["PENDING", "PUBLISHED", "ARCHIVED"]);

export const mediaAssetSchema = z.strictObject({
  event_media_asset_id: id,
  edition_id: id,
  media_type: z.string(),
  storage_object_key: z.string(),
  alt_text: z.string(),
  status: mediaStatus,
  sort_order: z.int(),
  focal_point: z.record(z.string(), z.unknown()).nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const mediaAssetListSchema = z.strictObject({
  items: z.array(mediaAssetSchema),
  next_cursor: z.strictObject({ sort_order: z.int(), event_media_asset_id: id }).nullable(),
});

export const mediaAssetListQuerySchema = z.strictObject({
  status: mediaStatus.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// A reference, not an upload: storage_object_key is the Cloudinary public id of an asset that already exists (the shape
// lib/shared/media-url.ts can deliver; an https URL is refused). Content blocks can only use a PUBLISHED asset.
export const createMediaAssetBodySchema = z.strictObject({
  media_type: z.enum(["IMAGE"]),
  storage_object_key: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(isPublicMediaKey, { message: "Not a plain storage object key (no scheme, host or .. segment)" }),
  alt_text: z.string().trim().min(1).max(300),
  status: z.enum(["PENDING", "PUBLISHED"]).optional(),
  sort_order: z.int().min(0).max(10000).optional(),
  focal_point: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().optional(),
});

// ---- Media asset lifecycle (P3-O, Master 52) ----

// A metadata PATCH names only what changes (focal_point: null clears it). expected_updated_at is the asset's updated_at as last read: a stale one is 409
// STALE_STATE. status is not editable here (publish / archive are their own commands) and the storage key can only change while the asset is PENDING.
export const updateMediaAssetBodySchema = z
  .strictObject({
    expected_updated_at: z.iso.datetime({ offset: true }),
    alt_text: z.string().trim().min(1).max(300).optional(),
    sort_order: z.int().min(0).max(10000).optional(),
    focal_point: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().optional(),
    storage_object_key: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(isPublicMediaKey, { message: "Not a plain storage object key (no scheme, host or .. segment)" })
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 1, { message: "At least one field to change is required" });

export const mediaAssetTransitionBodySchema = z.strictObject({ expected_updated_at: z.iso.datetime({ offset: true }) });

// ---- Anti-hoarding policy (P3-D RPCs, P3-L HTTP surface) ----

export const antiHoardingPolicySchema = z.strictObject({
  captcha_new_account_hours: z.int(),
  large_hold_min_places: z.int(),
  new_account_hold_share_percent: z.number(),
  new_account_hold_min_places: z.int(),
  single_buyer_hold_places: z.int(),
  updated_at: timestamp,
});

// Bounds mirror private.update_anti_hoarding_policy (the database stays the source of truth). A PATCH changes only what it names.
export const updateAntiHoardingPolicyBodySchema = z
  .strictObject({
    captcha_new_account_hours: z.int().min(1).max(168).optional(),
    large_hold_min_places: z.int().min(2).max(20).optional(),
    new_account_hold_share_percent: z.number().min(0.01).max(100).optional(),
    new_account_hold_min_places: z.int().min(1).max(100000).optional(),
    single_buyer_hold_places: z.int().min(2).max(20).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "At least one policy field is required" });

// ---- Params ----

export const eventIdParamSchema = z.strictObject({ eventId: id });
export const editionIdParamSchema = z.strictObject({ editionId: id });
export const modalityIdParamSchema = z.strictObject({ modalityId: id });
export const priceOfferIdParamSchema = z.strictObject({ priceOfferId: id });
export const categoryIdParamSchema = z.strictObject({ categoryId: id });
export const formIdParamSchema = z.strictObject({ formId: id });
export const locationIdParamSchema = z.strictObject({ locationId: id });
export const agendaItemIdParamSchema = z.strictObject({ itemId: id });
export const contentBlockIdParamSchema = z.strictObject({ blockId: id });
export const mediaAssetIdParamSchema = z.strictObject({ assetId: id });
export const kitDefinitionIdParamSchema = z.strictObject({ kitDefinitionId: id });
export const kitVariantIdParamSchema = z.strictObject({ kitVariantId: id });
export const legalDocumentIdParamSchema = z.strictObject({ documentId: id });
export const legalVersionIdParamSchema = z.strictObject({ versionId: id });
export const documentKeyParamSchema = z.strictObject({ documentKey: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/) });

export { formPublishResultSchema, legalVersionPublishResultSchema, editionUpdateResultSchema, setScheduleResultSchema };
