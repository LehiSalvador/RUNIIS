import "server-only";
import { z } from "zod";

// Mirrors the raceday_* private functions (supabase/migrations/2026092817*). Scan/pickup commands never
// throw a domain error for a scan-shaped rejection: `outcome` carries the Master §85 vocabulary verbatim.

const id = z.guid();
const timestamp = z.string().min(1);

export const scanOutcomeSchema = z.enum([
  "VALID",
  "ALREADY_CHECKED_IN",
  "REVOKED_CREDENTIAL",
  "REPLACED_CREDENTIAL",
  "WRONG_EVENT",
  "REGISTRATION_NOT_CONFIRMED",
  "GUARDIAN_VERIFICATION_REQUIRED",
  "UNKNOWN_PASS",
  "CANCELED_REGISTRATION",
  "NOT_YET_ALLOWED",
  "OTHER_REVIEW",
]);
export type ScanOutcome = z.output<typeof scanOutcomeSchema>;

export const participantMinimalSchema = z.strictObject({
  registration_id: id,
  registration_number: z.string(),
  registration_status: z.string(),
  participant_kind: z.enum(["PROFILE", "GUEST"]),
  display_name: z.string().nullable(),
  avatar_object_key: z.string().nullable(),
  modality: z.strictObject({ modality_id: id, name: z.string() }),
  category: z.strictObject({ category_id: id, name: z.string() }).nullable(),
  is_minor: z.boolean(),
  guardian_state: z.enum(["PENDING", "VERIFIED", "REJECTED"]).nullable(),
});
export type ParticipantMinimal = z.output<typeof participantMinimalSchema>;

export const checkInScanResultSchema = z.strictObject({
  participant_pass_scan_id: id,
  outcome: scanOutcomeSchema,
  scanned_at: timestamp,
  participant: participantMinimalSchema.nullable(),
});
export type CheckInScanResult = z.output<typeof checkInScanResultSchema>;

export const kitPickupResultSchema = z.strictObject({
  participant_pass_scan_id: id,
  kit_pickup_id: id.nullable(),
  outcome: scanOutcomeSchema,
  participant: participantMinimalSchema.nullable(),
});
export type KitPickupResult = z.output<typeof kitPickupResultSchema>;

export const guardianDecisionResultSchema = z.strictObject({
  registration_id: id,
  status: z.enum(["VERIFIED", "REJECTED"]),
});

export const guardianVerificationListItemSchema = z.strictObject({
  guardian_event_verification_id: id,
  status: z.enum(["PENDING", "REJECTED"]),
  created_at: timestamp,
  participant: participantMinimalSchema,
});
export const guardianVerificationListSchema = z.strictObject({ items: z.array(guardianVerificationListItemSchema) });

export const kitVariantInventorySchema = z.strictObject({
  kit_variant_id: id,
  variant_key: z.string(),
  label: z.string(),
  status: z.string(),
  capacity: z.number().int().nullable(),
  allocated_count: z.number().int(),
  delivered_count: z.number().int(),
  pending_count: z.number().int(),
  exception_count: z.number().int(),
  available: z.number().int().nullable(),
});
export const kitInventoryItemSchema = z.strictObject({
  kit_definition_id: id,
  name: z.string(),
  status: z.string(),
  pickup_start_at: timestamp.nullable(),
  pickup_end_at: timestamp.nullable(),
  variants: z.array(kitVariantInventorySchema),
});
export const kitInventorySchema = z.strictObject({ items: z.array(kitInventoryItemSchema) });

export const reverseKitPickupResultSchema = z.strictObject({ kit_pickup_id: id, status: z.literal("REVERSED") });
export const changeKitAllocationSizeResultSchema = z.strictObject({
  kit_allocation_id: id,
  kit_variant_id: id,
  status: z.string(),
});

export const participantSearchItemSchema = z.strictObject({
  registration_id: id,
  participant_pass_id: id.nullable(),
  registration_number: z.string(),
  display_name: z.string().nullable(),
  modality: z.strictObject({ modality_id: id, name: z.string() }),
  guardian_state: z.enum(["PENDING", "VERIFIED", "REJECTED"]).nullable(),
});
export const participantSearchSchema = z.strictObject({ items: z.array(participantSearchItemSchema) });

// ---- Route input schemas -----------------------------------------------------------------------

export const checkInScanBodySchema = z.strictObject({
  edition_id: id,
  credential_token: z.string().min(1).max(200),
  station_key: z.string().min(1).max(100).optional(),
});

export const manualVerifyBodySchema = z.strictObject({
  edition_id: id,
  participant_pass_id: id,
  reason: z.string().trim().min(1).max(500),
  station_key: z.string().min(1).max(100).optional(),
});

export const participantSearchQuerySchema = z.strictObject({ q: z.string().min(1).max(200) });

export const kitInventoryQuerySchema = z.strictObject({ edition_id: id });

export const kitPickupBodySchema = z
  .strictObject({
    edition_id: id,
    kit_definition_id: id,
    credential_token: z.string().min(1).max(200).optional(),
    registration_id: id.optional(),
    station_key: z.string().min(1).max(100).optional(),
    third_party: z.boolean().optional(),
    third_party_reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((body) => (body.credential_token == null) !== (body.registration_id == null), {
    message: "exactly one of credential_token or registration_id is required",
    path: ["credential_token"],
  });

export const kitPickupReverseBodySchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });

export const kitAllocationSizeBodySchema = z.strictObject({
  new_kit_variant_id: id,
  reason: z.string().trim().min(1).max(500),
});

export const guardianVerifyBodySchema = z.strictObject({
  verification_method: z.string().trim().min(1).max(100),
  notes: z.string().trim().min(1).max(500).optional(),
});

export const guardianRejectBodySchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });

export const guardianListQuerySchema = z.strictObject({ edition_id: id });
