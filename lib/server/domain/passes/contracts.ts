import "server-only";
import { z } from "zod";

// Mirrors private.participant_pass_view (supabase/migrations/20260928140300_143_passes.sql). No function
// callable by anon/authenticated ever returns credential material (token, hash, ciphertext, key version).

const id = z.guid();
const timestamp = z.string().min(1);

export const participantPassSchema = z.strictObject({
  participant_pass_id: id,
  public_code: z.string(),
  status: z.string(),
  issued_at: timestamp,
  canceled_at: timestamp.nullable(),
  has_active_credential: z.boolean(),
  registration: z.strictObject({
    registration_id: id,
    registration_number: z.string(),
    status: z.string(),
    confirmed_at: timestamp.nullable(),
  }),
  participant: z.strictObject({
    participant_kind: z.enum(["PROFILE", "GUEST"]),
    is_self: z.boolean(),
    display_name: z.string().nullable(),
  }),
  edition: z.strictObject({
    edition_id: id,
    name: z.string(),
    slug: z.string(),
    event_date: z.iso.date().nullable(),
  }),
  modality: z.strictObject({ modality_id: id, name: z.string() }),
  category: z.strictObject({ category_id: id, name: z.string() }).nullable(),
});
export type ParticipantPassView = z.output<typeof participantPassSchema>;

export const passListSchema = z.strictObject({ items: z.array(participantPassSchema) });

export const replaceCredentialResultSchema = z.strictObject({
  participant_pass_id: id,
  replaced_credential_id: id,
  replaced_version: z.number().int(),
  next_version: z.number().int(),
});
