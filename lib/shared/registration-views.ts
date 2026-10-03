import { z } from "zod";
import { REQUEST_STATUSES } from "./registration";

// Client-safe views of a RegistrationRequest (Master §61-76). Single definition shared by the server
// (strict validation of RPC output, SEC-120) and the participant UI. Mirrors the jsonb projection of
// private.registration_request_view in supabase/migrations/20260928140200_142_*.sql exactly: an
// unexpected key fails closed as INTERNAL_ERROR instead of reaching the client. Keys appended only for
// staff (`buyer`, `cancel_reason`) are `.optional()` and never present in buyer views.

const id = z.guid();
const timestamp = z.string().min(1);

export const modalityRefSchema = z.strictObject({ modality_id: id, name: z.string() });
export const categoryRefSchema = z.strictObject({ category_id: id, name: z.string() }).nullable();

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
