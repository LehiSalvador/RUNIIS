import "server-only";
import { z } from "zod";
import { REQUEST_STATUSES } from "@/lib/shared/registration";

// Output schemas mirror the jsonb projections in supabase/migrations/20260928140200_142_*.sql and
// 140400_144_*.sql exactly: an unexpected key fails closed as INTERNAL_ERROR instead of reaching the
// client (SEC-120). Keys the SQL always includes (even as null) are `.nullable()`; keys appended only
// for staff (`|| case when p_staff then ... else '{}' end`) are `.optional()`.

const id = z.guid();
const timestamp = z.string().min(1);

const modalityRefSchema = z.strictObject({ modality_id: id, name: z.string() });
const categoryRefSchema = z.strictObject({ category_id: id, name: z.string() }).nullable();

const registrationRefSchema = z
  .strictObject({
    registration_id: id,
    registration_number: z.string(),
    status: z.string(),
    participant_pass_id: id.nullable(),
  })
  .nullable();

const kitSelectionRefSchema = z
  .strictObject({ kit_definition_id: id, kit_variant_id: id, label: z.string() })
  .nullable();

const requestParticipantSchema = z.strictObject({
  request_participant_id: id,
  participant_kind: z.enum(["PROFILE", "GUEST"]),
  public_profile_id: id.nullable(),
  guest_participant_id: id.nullable(),
  is_buyer: z.boolean(),
  display_name: z.string().nullable(),
  modality: modalityRefSchema,
  category: categoryRefSchema,
  price_snapshot_minor: z.number().int(),
  legal_acceptance_status: z.enum(["ACCEPTED", "PENDING"]),
  kit_selection: kitSelectionRefSchema,
  registration: registrationRefSchema,
});

export const registrationRequestSchema = z.strictObject({
  registration_request_id: id,
  public_reference: z.string(),
  edition: z.strictObject({ edition_id: id, name: z.string(), slug: z.string() }),
  status: z.enum(REQUEST_STATUSES),
  effective_status: z.enum(REQUEST_STATUSES),
  registration_mode: z.enum(["FREE", "EXTERNAL_WHATSAPP"]),
  currency: z.string(),
  total_snapshot_minor: z.number().int(),
  created_at: timestamp,
  expires_at: timestamp.nullable(),
  confirmed_at: timestamp.nullable(),
  canceled_at: timestamp.nullable(),
  revalidated_from_expired: z.boolean(),
  whatsapp_phone_e164: z.string().nullable(),
  server_time: timestamp,
  participants: z.array(requestParticipantSchema),
  // Staff-only (registration_request_view p_staff=true).
  buyer: z
    .strictObject({
      public_profile_id: id.nullable(),
      full_name: z.string(),
      phone_e164: z.string(),
      is_new_account: z.boolean(),
    })
    .optional(),
  cancel_reason: z.string().nullable().optional(),
});
export type RegistrationRequestView = z.output<typeof registrationRequestSchema>;

const requestCursorSchema = z.strictObject({ created_at: timestamp, registration_request_id: id }).nullable();

export const registrationRequestPageSchema = z.strictObject({
  items: z.array(registrationRequestSchema),
  next_cursor: requestCursorSchema,
});

export const adminRegistrationRequestPageSchema = z.strictObject({
  items: z.array(registrationRequestSchema),
  next_cursor: requestCursorSchema,
  counts: z.record(z.enum(REQUEST_STATUSES), z.number().int()),
});

// ---- Participants (Master §172) ----

const participantPassRefSchema = z
  .strictObject({ participant_pass_id: id, public_code: z.string(), status: z.string(), has_active_credential: z.boolean() })
  .nullable();
const kitAllocationRefSchema = z
  .strictObject({ status: z.string(), kit_variant_id: id, variant_label: z.string() })
  .nullable();

export const participantRowSchema = z.strictObject({
  registration_id: id,
  registration_number: z.string(),
  status: z.string(),
  confirmed_at: timestamp.nullable(),
  participant_kind: z.enum(["PROFILE", "GUEST"]),
  full_name: z.string().nullable(),
  public_profile_id: id.nullable(),
  buyer_full_name: z.string(),
  registration_request_id: id,
  modality: modalityRefSchema,
  category: categoryRefSchema,
  is_minor: z.boolean(),
  guardian_verification_status: z.string().nullable(),
  pass: participantPassRefSchema,
  kit: kitAllocationRefSchema,
  attendance: z.strictObject({ checked_in: z.boolean(), resolution_status: z.string().nullable() }),
  contact: z
    .strictObject({
      phone_e164: z.string().nullable(),
      emergency_contact_name: z.string().nullable(),
      emergency_contact_phone_e164: z.string().nullable(),
    })
    .nullable(),
});
export type ParticipantRow = z.output<typeof participantRowSchema>;

const participantCursorSchema = z.strictObject({ sort_name: z.string(), registration_id: id }).nullable();

export const participantPageSchema = z.strictObject({
  items: z.array(participantRowSchema),
  next_cursor: participantCursorSchema,
  contact_visible: z.boolean(),
});

export const participantExportSchema = z.strictObject({
  rows: z.array(participantRowSchema),
  row_count: z.number().int(),
  truncated: z.boolean(),
  edition: z.strictObject({ edition_id: id, slug: z.string() }),
});

// ---- Pending actions / legal acceptance (Master §124) ----

const pendingActionSubjectSchema = z.union([
  z.strictObject({ kind: z.literal("SELF") }),
  z.strictObject({ kind: z.literal("MINOR_PROFILE"), public_profile_id: id.nullable(), display_name: z.string().nullable() }),
  z.strictObject({ kind: z.literal("MINOR_GUEST"), guest_participant_id: id, display_name: z.string().nullable() }),
]);

export const pendingActionsSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      action_type: z.literal("LEGAL_ACCEPTANCE_REQUIRED"),
      edition: z.strictObject({ edition_id: id, name: z.string(), slug: z.string() }),
      subject: pendingActionSubjectSchema,
      documents: z.array(z.strictObject({ legal_document_version_id: id, document_type: z.string(), version: z.number().int() })),
    }),
  ),
});

export const acceptDocumentsResultSchema = z.strictObject({
  edition_id: id,
  missing_document_version_ids: z.array(id),
});

// ---- Inputs ----

export const registrationRequestListQuerySchema = z.strictObject({
  status: z.enum(REQUEST_STATUSES).optional(),
  cursor: z.string().optional(),
});

export const cancelRequestBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const staffCancelBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

export const revalidateConfirmBodySchema = z.strictObject({
  expected_total_minor: z.int().nonnegative().optional(),
});

export const replaceCredentialBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

export const adminRequestListQuerySchema = z.strictObject({
  status: z.enum(REQUEST_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const participantFilterFields = {
  status: z.enum(["CONFIRMED", "CANCELED"]).optional(),
  modality_id: id.optional(),
  type: z.enum(["PROFILE", "GUEST"]).optional(),
  kit: z.enum(["ASSIGNED", "READY", "DELIVERED", "CANCELED", "EXCEPTION", "NONE"]).optional(),
  attendance: z.enum(["PENDING", "PRESENT", "NO_SHOW", "EXCLUDED", "NONE"]).optional(),
  search: z.string().trim().max(100).optional(),
};

export const participantListQuerySchema = z.strictObject({
  ...participantFilterFields,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const participantExportQuerySchema = z.strictObject({
  ...participantFilterFields,
  reason: z.string().trim().min(3).max(500),
});

export const pendingActionsQuerySchema = z.strictObject({
  edition_id: id.optional(),
});

export const acceptDocumentsBodySchema = z
  .strictObject({
    edition_id: id,
    legal_document_version_ids: z.array(id).min(1).max(10),
    minor_public_profile_id: id.optional(),
    minor_guest_participant_id: id.optional(),
  })
  .refine((body) => !(body.minor_public_profile_id && body.minor_guest_participant_id), {
    message: "only one minor reference is allowed",
    path: ["minor_public_profile_id"],
  });

export const requestCursorParamSchema = z.strictObject({ id });
export const editionParamSchema = z.strictObject({ editionId: id });
export const passParamSchema = z.strictObject({ passId: id });
