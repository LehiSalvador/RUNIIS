import { z } from "zod";
import { CANCEL_REASON_CATEGORIES, cancelNotificationSchema } from "./closure";

// Client-safe contract of the registration API (Master §61-84, §167-172). Pure: no server imports.

export const MAX_REQUEST_PARTICIPANTS = 20;
const MAX_TEXT_RESPONSE = 2000;
const FIELD_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

export const REQUEST_STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "CANCELED_BY_BUYER", "CANCELED_BY_STAFF", "EXPIRED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Master §63/§72: expiry is effective at expires_at whether or not the worker has materialised it. */
export function effectiveRequestStatus(status: RequestStatus, expiresAt: string | null, now: Date = new Date()): RequestStatus {
  if (status === "PENDING_CONFIRMATION" && expiresAt !== null && now.getTime() >= Date.parse(expiresAt)) return "EXPIRED";
  return status;
}

const responseValueSchema = z.union([
  z.string().max(MAX_TEXT_RESPONSE),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.null(),
]);

export const participantInputSchema = z
  .strictObject({
    kind: z.enum(["PROFILE", "GUEST"]),
    /** Friends and the buyer are addressed by their public profile id; runner ids stay internal. */
    public_profile_id: z.uuid().optional(),
    guest_participant_id: z.uuid().optional(),
    modality_id: z.uuid(),
    category_id: z.uuid().optional(),
    responses: z
      .record(z.string().regex(FIELD_KEY), responseValueSchema)
      .refine((value) => Object.keys(value).length <= 100, "too many responses")
      .optional(),
    kit_selection: z.strictObject({ kit_definition_id: z.uuid(), kit_variant_id: z.uuid() }).optional(),
  })
  .superRefine((participant, context) => {
    const valid =
      participant.kind === "PROFILE"
        ? participant.public_profile_id !== undefined && participant.guest_participant_id === undefined
        : participant.guest_participant_id !== undefined && participant.public_profile_id === undefined;
    if (!valid) context.addIssue({ code: "custom", message: "participant id must match kind", path: ["kind"] });
  });

export const legalAcceptanceInputSchema = z.strictObject({
  participant_index: z.int().min(0).max(MAX_REQUEST_PARTICIPANTS - 1),
  legal_document_version_id: z.uuid(),
});

/**
 * OD-P2-01 anti-hoarding. An EXTERNAL_WHATSAPP request from an account younger than `new_account_hours` (server time) needs the
 * solved ALTCHA payload of a challenge issued for this purpose. FREE Editions and older accounts never see it.
 */
export const REGISTRATION_CAPTCHA_PURPOSE = "registration_request" as const;
export const REGISTRATION_CAPTCHA_REASONS = ["captcha_required", "captcha_invalid"] as const;
export type RegistrationCaptchaReason = (typeof REGISTRATION_CAPTCHA_REASONS)[number];

/** The widget's solved payload (base64 JSON), sent back verbatim as `altcha`. */
export const altchaPayloadSchema = z.string().min(1).max(2000);

/** ALTCHA challenge as the widget consumes it (`challengejson`). */
export const altchaChallengeSchema = z.strictObject({
  algorithm: z.enum(["SHA-1", "SHA-256", "SHA-512"]),
  challenge: z.string(),
  maxnumber: z.number().int().optional(),
  salt: z.string(),
  signature: z.string(),
});
export type AltchaChallengeView = z.output<typeof altchaChallengeSchema>;

export const createRegistrationRequestBodySchema = z.strictObject({
  edition_id: z.uuid(),
  participants: z.array(participantInputSchema).min(1).max(MAX_REQUEST_PARTICIPANTS),
  legal_acceptances: z.array(legalAcceptanceInputSchema).max(MAX_REQUEST_PARTICIPANTS * 5).default([]),
  /** Solved ALTCHA payload; only meaningful (and only read) when the server answered `captcha_required`. */
  altcha: altchaPayloadSchema.optional(),
});
export type CreateRegistrationRequestBody = z.output<typeof createRegistrationRequestBodySchema>;

/** `error.details` of the 422 BUSINESS_RULE_VIOLATION the create endpoint answers when the challenge is missing or wrong. */
export const registrationCaptchaErrorDetailsSchema = z.object({
  reason: z.enum(REGISTRATION_CAPTCHA_REASONS),
  captcha: z.object({
    purpose: z.literal(REGISTRATION_CAPTCHA_PURPOSE),
    edition_id: z.uuid(),
    new_account_hours: z.int(),
    /** A fresh challenge, ready for the widget: solve it and resubmit the SAME body with the SAME Idempotency-Key plus `altcha`. */
    challenge: altchaChallengeSchema,
    challenge_endpoint: z.string(),
  }),
});
export type RegistrationCaptchaErrorDetails = z.output<typeof registrationCaptchaErrorDetailsSchema>;

/** GET /api/v1/registration-requests/challenge?edition_id= */
export const registrationCaptchaQuerySchema = z.strictObject({ edition_id: z.uuid() });
export const registrationCaptchaStatusSchema = z.strictObject({
  /** EXTERNAL_WHATSAPP and an account younger than `new_account_hours`. */
  applies: z.boolean(),
  /** `applies` and no valid clearance held yet: show the widget before submitting. */
  required: z.boolean(),
  has_clearance: z.boolean(),
  new_account_hours: z.int(),
  /** Present only when `required`. */
  challenge: altchaChallengeSchema.nullable(),
});
export type RegistrationCaptchaStatus = z.output<typeof registrationCaptchaStatusSchema>;

export const cancelReasonSchema = z.string().trim().min(1).max(500);

// ---- Staff bulk cancellation of PENDING requests (OD-P2-01, P3-D) ----

/** Hard bound of one batch; the database enforces it too. */
export const BULK_CANCEL_MAX_REQUESTS = 100;
export const BULK_CANCEL_OUTCOMES = ["CANCELED", "ALREADY_CANCELED", "NOT_CANCELABLE", "NOT_FOUND", "FAILED"] as const;
export type BulkCancelOutcome = (typeof BULK_CANCEL_OUTCOMES)[number];

/** POST /api/v1/admin/editions/{editionId}/registration-requests/bulk-cancel: explicit ids only, one internal reason for the batch. */
export const bulkCancelRequestsBodySchema = z.strictObject({
  request_ids: z
    .array(z.guid())
    .min(1)
    .max(BULK_CANCEL_MAX_REQUESTS)
    .refine((ids) => new Set(ids.map((value) => value.toLowerCase())).size === ids.length, "duplicate ids"),
  reason: cancelReasonSchema,
  /** Closed category the buyer's email shows (the free-text reason never leaves staff surfaces). Optional, default OTHER. */
  reason_category: z.enum(CANCEL_REASON_CATEGORIES).optional(),
});
export type BulkCancelRequestsBody = z.output<typeof bulkCancelRequestsBodySchema>;

const bulkCancelResultRowSchema = z.strictObject({
  registration_request_id: z.guid(),
  outcome: z.enum(BULK_CANCEL_OUTCOMES),
  /** Resulting (CANCELED, ALREADY_CANCELED) or current (NOT_CANCELABLE) request status. */
  status: z.string().optional(),
  /** Stable domain code of an unexpected per-id failure (outcome FAILED); retry that id. */
  code: z.string().optional(),
  /**
   * P3-S (UX J2 step 4): present on outcome CANCELED only. Whether the buyer will be emailed (`queued`), cannot be (`suppressed`, `no_contact`:
   * an ACTION_REQUIRED follow-up task is open, `follow_up_task_id`) or the outcome could not be read right now (`unknown`; the cancellation
   * itself is committed and the outbox consumer opens the follow-up when needed).
   */
  notification: cancelNotificationSchema.optional(),
});
export const bulkCancelResultSchema = z.strictObject({
  edition_id: z.guid(),
  /** Links the per-request audit records of this batch. */
  correlation_id: z.guid(),
  requested_count: z.int(),
  canceled_count: z.int(),
  already_canceled_count: z.int(),
  /** NOT_CANCELABLE (CONFIRMED, buyer-canceled...) plus NOT_FOUND (unknown or another Edition). */
  rejected_count: z.int(),
  failed_count: z.int(),
  results: z.array(bulkCancelResultRowSchema),
});
export type BulkCancelResult = z.output<typeof bulkCancelResultSchema>;
