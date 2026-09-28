import "server-only";
import { z } from "zod";

export const editionIdParamSchema = z.strictObject({ edition: z.uuid() });
export const reminderIdParamSchema = z.strictObject({ reminderId: z.uuid() });

// F1/SEC-082: `altcha` is the widget's solved ALTCHA payload (base64 JSON), verified server-side
// before any rate limit is consumed or command runs (lib/server/domain/communications/captcha.ts).
export const anonymousReminderBodySchema = z.strictObject({ edition_id: z.uuid(), email: z.email().max(254), altcha: z.string().min(1).max(2000) });

export const reminderChallengeResultSchema = z.object({
  algorithm: z.enum(["SHA-1", "SHA-256", "SHA-512"]),
  challenge: z.string(),
  salt: z.string(),
  signature: z.string(),
  maxnumber: z.number().int().optional(),
});
export const confirmTokenBodySchema = z.strictObject({ token: z.string().regex(/^[0-9a-f]{16,256}$/) });

export const preferencesPatchSchema = z
  .strictObject({
    general_marketing: z.boolean().nullish(),
    event_reminder: z.boolean().nullish(),
    other_optional: z.boolean().nullish(),
  })
  .refine((body) => body.general_marketing != null || body.event_reminder != null || body.other_optional != null, {
    message: "at least one preference must be provided",
  });

export const favoriteResultSchema = z.object({ edition_id: z.uuid(), favorite: z.boolean() });
export const favoriteListItemSchema = z.object({
  edition_id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  registration_state: z.string(),
  execution_state: z.string(),
  favorited_at: z.string(),
  reminder: z.object({ reminder_id: z.uuid(), status: z.string() }).nullable(),
});
export const favoriteListSchema = z.array(favoriteListItemSchema);

export const reminderResultSchema = z.object({ reminder_id: z.uuid(), edition_id: z.uuid().nullable(), status: z.string() });
export const anonymousReminderResultSchema = z.object({ accepted: z.literal(true) });
export const confirmReminderResultSchema = z.object({ status: z.literal("CONFIRMED"), edition: z.object({ slug: z.string(), name: z.string() }) });
export const unsubscribeResultSchema = z.object({ status: z.literal("UNSUBSCRIBED"), scope: z.enum(["MARKETING", "REMINDERS"]) });

// ---- Admin console (Master §134-135, §176, §197) ----

export const campaignIdParamSchema = z.strictObject({ campaignId: z.uuid() });

export const createCampaignBodySchema = z.strictObject({
  campaign_type: z.enum(["MARKETING", "OPERATIONAL"]),
  template_key: z.string().min(1).max(100),
  edition_id: z.uuid(),
  audience: z.record(z.string(), z.unknown()),
  template_variables: z.record(z.string(), z.unknown()).default({}),
});
export const scheduleCampaignBodySchema = z.strictObject({ scheduled_for: z.iso.datetime({ offset: true }) });
export const cancelCampaignBodySchema = z.strictObject({ reason: z.string().max(500).nullish() });

export const listCampaignsQuerySchema = z.strictObject({
  edition_id: z.uuid().optional(),
  status: z.enum(["DRAFT", "READY", "SCHEDULED", "SENDING", "COMPLETED", "FAILED", "CANCELED"]).optional(),
  before_created_at: z.iso.datetime({ offset: true }).optional(),
  before_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const listMessagesQuerySchema = z.strictObject({
  edition_id: z.uuid().optional(),
  campaign_id: z.uuid().optional(),
  status: z.string().optional(),
  template_key: z.string().optional(),
  before_created_at: z.iso.datetime({ offset: true }).optional(),
  before_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const campaignProjectionSchema = z.object({
  campaign_id: z.uuid(),
  campaign_type: z.string(),
  edition_id: z.uuid().nullable(),
  template_key: z.string(),
  status: z.string(),
  purpose: z.string(),
  audience_definition: z.record(z.string(), z.unknown()),
  template_variables: z.record(z.string(), z.unknown()),
  estimated_recipient_count: z.number().int().nullable(),
  scheduled_for: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  canceled_at: z.string().nullable(),
  message_counts: z.record(z.string(), z.number().int()),
});
export const sendCampaignResultSchema = campaignProjectionSchema.extend({
  snapshot: z.object({ candidates: z.number().int(), excluded: z.number().int() }).optional(),
});
export const previewCampaignResultSchema = z.object({
  campaign: campaignProjectionSchema,
  template: z.object({
    template_key: z.string(),
    version: z.number().int(),
    category: z.string().nullable(),
    subject: z.string(),
    html_template: z.string(),
    text_template: z.string(),
    variable_schema: z.record(z.string(), z.unknown()),
  }),
  sample_variables: z.record(z.string(), z.unknown()),
});
export const listCampaignsResultSchema = z.object({ items: z.array(campaignProjectionSchema), has_more: z.boolean() });

export const messageListItemSchema = z.object({
  message_id: z.uuid(),
  template_key: z.string(),
  category: z.string(),
  priority: z.number().int(),
  status: z.string(),
  recipient_type: z.string(),
  email_masked: z.string(),
  edition_id: z.uuid().nullable(),
  campaign_id: z.uuid().nullable(),
  registration_id: z.uuid().nullable(),
  subject: z.string(),
  scheduled_for: z.string(),
  sent_at: z.string().nullable(),
  attempt_count: z.number().int(),
  last_error: z.string().nullable(),
  provider: z.string().nullable(),
  provider_status_at: z.string().nullable(),
  escalated: z.boolean(),
  created_at: z.string(),
});
export const listMessagesResultSchema = z.object({ items: z.array(messageListItemSchema), has_more: z.boolean() });

export const communicationMetricsSchema = z.object({
  outbox_pending_count: z.number().int(),
  outbox_oldest_age_seconds: z.number().int(),
  outbox_escalated_count: z.number().int(),
  communication_critical_backlog: z.number().int(),
  communication_critical_failed_24h: z.number().int(),
  waiting_for_quota_count: z.number().int(),
  active_suppressions: z.number().int(),
  worker_failed_count_24h: z.number().int(),
  provider_quota: z.array(
    z.object({ provider: z.string(), usage_date: z.string(), daily_limit: z.number().int(), used: z.number().int(), remaining: z.number().int(), critical_reserve: z.number().int() }),
  ),
});

const purposeStateSchema = z.object({ granted: z.boolean(), suppressed: z.boolean(), effective: z.boolean() });
export const preferencesResultSchema = z.object({
  contact: z.object({ has_email: z.boolean(), verified: z.boolean() }),
  purposes: z.object({ GENERAL_MARKETING: purposeStateSchema, EVENT_REMINDER: purposeStateSchema, OTHER_OPTIONAL: purposeStateSchema }),
  reminders: z.array(
    z.object({ reminder_id: z.uuid(), edition_id: z.uuid(), slug: z.string(), name: z.string(), status: z.string(), registration_state: z.string() }),
  ),
});
