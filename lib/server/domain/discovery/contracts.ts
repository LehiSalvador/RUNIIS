import "server-only";
import { z } from "zod";
import {
  categorySchema,
  contentBlockSchema,
  editionSchema,
  eventSchema,
  locationSchema,
  modalitySchema,
  scheduleItemSchema,
} from "@/lib/server/domain/events/contracts";

// Output schemas mirror the jsonb projections in supabase/migrations/20260928110000_310_discovery_queries.sql
// (private.discovery_*) exactly: an unexpected key fails closed as INTERNAL_ERROR instead of reaching
// the client (SEC-120). Reuses the events domain's zod schemas for sub-resources that are already
// public-safe (edition/event/modality/category/location/schedule_item/content_block projections).

const id = z.guid();
const timestamp = z.string().min(1);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---- Public availability (Master §36-37): state only, never raw counts ----

export const publicAvailabilitySchema = z
  .strictObject({
    edition_id: id,
    registration_state: z.enum(["NOT_OPEN", "OPEN", "PAUSED", "CLOSED"]),
    execution_state: z.enum(["SCHEDULED", "POSTPONED", "IN_PROGRESS", "FINISHED", "CANCELED"]),
    global_state: z.enum(["AVAILABLE", "LOW", "TEMPORARILY_UNAVAILABLE", "SOLD_OUT"]),
    modalities: z.array(
      z.strictObject({
        modality_id: id,
        status: z.enum(["ACTIVE", "CLOSED"]),
        state: z.enum(["AVAILABLE", "LOW", "TEMPORARILY_UNAVAILABLE", "SOLD_OUT"]),
      }),
    ),
  })
  .nullable();

// ---- Price (KERNEL_READY.md private.resolve_modality_price) ----

export const modalityPriceSchema = z
  .union([
    z.strictObject({
      source: z.literal("FREE"),
      price_offer_id: z.null(),
      modality_id: id,
      amount_minor: z.literal(0),
      currency: z.string(),
    }),
    z.strictObject({
      source: z.literal("PRICE_OFFER"),
      price_offer_id: id,
      modality_id: id,
      name: z.string(),
      amount_minor: z.int(),
      currency: z.string(),
      starts_at: timestamp.nullable(),
      ends_at: timestamp.nullable(),
      priority: z.int(),
    }),
  ])
  .nullable();

export const effectiveStartSchema = z
  .strictObject({
    edition_id: id,
    modality_id: id.nullable(),
    local_date: dateStr,
    local_start_time: z.string().nullable(),
    timezone: z.string(),
    start_at: timestamp.nullable(),
    sport_date: dateStr,
    time_source: z.enum(["MODALITY", "EDITION"]).nullable(),
    schedule_state: z.enum(["POSTPONED_NO_NEW_DATE", "DATE_CONFIRMED_TIME_PENDING", "DATE_TIME_CONFIRMED"]),
    edition_schedule_revision_id: id,
  })
  .nullable();

// ---- Event Card (Master §57, §191 minimal payload) ----

export const eventCardImageSchema = z.strictObject({ storage_object_key: z.string(), alt_text: z.string() }).nullable();

export const modalitySummarySchema = z.strictObject({
  count: z.int(),
  min_distance_m: z.int().nullable(),
  max_distance_m: z.int().nullable(),
  distance_varies: z.boolean(),
  min_amount_minor: z.number().int().nullable(),
  max_amount_minor: z.number().int().nullable(),
  currency: z.string().nullable(),
  price_varies: z.boolean(),
  price_pending: z.boolean(),
});

export const eventCardSchema = z.strictObject({
  edition_id: id,
  slug: z.string(),
  name: z.string(),
  city: z.string(),
  state_region: z.string(),
  country_code: z.string(),
  sport_date: dateStr.nullable(),
  registration_state: z.enum(["NOT_OPEN", "OPEN", "PAUSED", "CLOSED"]),
  execution_state: z.enum(["SCHEDULED", "POSTPONED", "IN_PROGRESS", "FINISHED", "CANCELED"]),
  registration_mode: z.enum(["FREE", "EXTERNAL_WHATSAPP"]),
  availability: publicAvailabilitySchema,
  modality_summary: modalitySummarySchema,
  image: eventCardImageSchema,
});

const searchCursorSchema = z.strictObject({ bucket: z.int(), sort_num: z.number(), edition_id: id }).nullable();

export const searchEditionsResultSchema = z.strictObject({
  items: z.array(eventCardSchema),
  next_cursor: searchCursorSchema,
});

export const homeDataSchema = z.strictObject({
  upcoming: z.array(eventCardSchema),
  community_slot: z.strictObject({ available: z.boolean(), reason: z.string() }),
});

// ---- Event Page (Master §58 levels 1-3) ----

const discoveryModalitySchema = modalitySchema.extend({ price: modalityPriceSchema, effective_start: effectiveStartSchema });

const discoveryKitVariantSchema = z.strictObject({
  kit_variant_id: id,
  variant_key: z.string(),
  label: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});
const discoveryKitSchema = z.strictObject({
  kit_definition_id: id,
  name: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  pickup_start_at: timestamp.nullable(),
  pickup_end_at: timestamp.nullable(),
  instructions: z.string().nullable(),
  variants: z.array(discoveryKitVariantSchema),
});

const discoveryMediaSchema = z.strictObject({
  // event_media_asset_id lets the caller match an IMAGE/GALLERY/SPONSOR_GROUP content block's
  // payload.event_media_asset_id (private.cfg_media_ref) to its resolved media here.
  event_media_asset_id: id,
  storage_object_key: z.string(),
  alt_text: z.string(),
  media_type: z.string(),
  sort_order: z.int(),
  focal_point: z.record(z.string(), z.unknown()).nullable(),
});

const resolvedWhatsappSchema = z.strictObject({ phone_e164: z.string().nullable(), source: z.enum(["EDITION", "PLATFORM"]).nullable() });

export const editionPageSchema = z.strictObject({
  edition: editionSchema,
  event: eventSchema,
  whatsapp: resolvedWhatsappSchema,
  availability: publicAvailabilitySchema,
  is_past: z.boolean(),
  modalities: z.array(discoveryModalitySchema),
  categories: z.array(categorySchema),
  locations: z.array(locationSchema),
  agenda: z.array(scheduleItemSchema),
  content_blocks: z.array(contentBlockSchema),
  kits: z.array(discoveryKitSchema),
  media: z.array(discoveryMediaSchema),
});

export const editionPageResultSchema = z
  .union([z.strictObject({ redirect: z.literal(true), slug: z.string() }), z.strictObject({ redirect: z.literal(false), edition: editionPageSchema })])
  .nullable();

export const sitemapEntrySchema = z.strictObject({ slug: z.string(), updated_at: timestamp, published_at: timestamp.nullable() });
export const sitemapEntriesSchema = z.array(sitemapEntrySchema);

// ---- Query params (GET /api/v1/events, Master §165) ----

const eventTypeKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/);
const priceFilter = z.enum(["FREE", "PAID"]);

function multi<S extends z.ZodType>(schema: S) {
  return z
    .union([schema, z.array(schema).max(20)])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]));
}

const boolQueryParam = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

export const searchEditionsQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(160).optional(),
  type: multi(eventTypeKey),
  date_from: dateStr.optional(),
  date_to: dateStr.optional(),
  distance_min_m: z.coerce.number().int().min(0).max(1000000).optional(),
  distance_max_m: z.coerce.number().int().min(0).max(1000000).optional(),
  location: z.string().trim().min(1).max(160).optional(),
  price: multi(priceFilter),
  registration_open: boolQueryParam,
  cursor: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const editionSlugParamSchema = z.strictObject({
  edition: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9](-?[a-z0-9]+)*$/),
});

// ---- Public event types & platform contact (GET /api/v1/event-types, GET /api/v1/platform/contact) ----

export const publicEventTypeSchema = z.strictObject({ key: z.string(), name: z.string() });
export const publicEventTypesSchema = z.array(publicEventTypeSchema);

// The effective default WhatsApp only (private.get_public_platform_contact): nothing else from
// platform_settings ever reaches a public route (SEC-008 — that table is definer-only, no RLS grant
// to any API role).
export const platformContactSchema = z.strictObject({ whatsapp_phone_e164: z.string().nullable() });
