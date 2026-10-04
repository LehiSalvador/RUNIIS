import "server-only";
import { z } from "zod";
import { CANCEL_REASON_CATEGORIES } from "@/lib/shared/closure";
import { REQUEST_STATUSES } from "@/lib/shared/registration";
import {
  categoryRefSchema,
  modalityRefSchema,
  registrationRequestSchema,
  type RegistrationRequestView,
} from "@/lib/shared/registration-views";

export { registrationRequestSchema, type RegistrationRequestView };

// Output schemas mirror the jsonb projections in supabase/migrations/20260928140200_142_*.sql and
// 140400_144_*.sql exactly: an unexpected key fails closed as INTERNAL_ERROR instead of reaching the
// client (SEC-120). Keys the SQL always includes (even as null) are `.nullable()`; keys appended only
// for staff (`|| case when p_staff then ... else '{}' end`) are `.optional()`.

const id = z.guid();
const timestamp = z.string().min(1);

const requestCursorSchema = z.strictObject({ created_at: timestamp, registration_request_id: id }).nullable();

export const registrationRequestPageSchema = z.strictObject({
  items: z.array(registrationRequestSchema),
  next_cursor: requestCursorSchema,
});

export const adminRegistrationRequestPageSchema = z.strictObject({
  items: z.array(registrationRequestSchema),
  next_cursor: requestCursorSchema,
  // jsonb_object_agg yields SQL NULL on an Edition without requests and only the effective statuses that exist
  // otherwise, so `counts` is nullable and partial (z.record over an enum would demand every status key).
  counts: z.partialRecord(z.enum(REQUEST_STATUSES), z.number().int()).nullable(),
});

// ---- Participants (Master §172) ----

const participantPassRefSchema = z
  .strictObject({ participant_pass_id: id, public_code: z.string(), status: z.string(), has_active_credential: z.boolean() })
  .nullable();
const kitAllocationRefSchema = z
  .strictObject({
    status: z.string(),
    kit_variant_id: id,
    variant_label: z.string(),
    // P3-Q (D2): reachable ids for the size-change API (allocation) and the pickup-reversal API (active DELIVERED pickup).
    kit_allocation_id: id,
    kit_definition_id: id,
    kit_pickup_id: id.nullable(),
  })
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
  attendance: z.strictObject({
    checked_in: z.boolean(),
    resolution_status: z.string().nullable(),
    // P3-S (T13 4.13): `finalized` = the Edition's attendance has a current finalization; `final_status` = the resolution status once finalized.
    finalized: z.boolean(),
    final_status: z.string().nullable(),
  }),
  // P3-S: sporting eligibility of the current resolution (null until the closure workspace created it).
  sporting_eligibility: z
    .strictObject({ status: z.string(), distance_credit_disposition: z.string(), reason_code: z.string().nullable() })
    .nullable(),
  // P3-S: integrity cases of the registration. `count`/`highest_severity` = OPEN cases (severity null when none); `total_count` = every case. No free text.
  incidents: z.strictObject({
    count: z.number().int(),
    highest_severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).nullable(),
    total_count: z.number().int(),
  }),
  // P3-S: credited distance (metres) of the ACTIVE DistanceCredit; null until the Edition is closed.
  credited_distance_m: z.number().int().nullable(),
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
  /** Closed category the buyer's cancellation email shows (the free-text reason stays internal). Optional, default OTHER. */
  reason_category: z.enum(CANCEL_REASON_CATEGORIES).optional(),
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
