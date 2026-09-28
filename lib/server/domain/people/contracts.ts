import "server-only";
import { z } from "zod";
import {
  E164_PATTERN,
  FRIENDSHIP_STATES,
  FRIENDSHIP_VIEWS,
  GUARDIAN_RELATIONSHIP_TYPES,
  GUARDIAN_STATUSES,
  GUEST_STATUSES,
  SEX_CODES,
} from "@/lib/shared/people";

// Output schemas are strict: a DB projection that grows an unexpected key (e.g. a DOB) fails closed
// as INTERNAL_ERROR instead of reaching the client (SEC-120, Master §18/§23).

const timestamp = z.string().min(1);
const id = z.guid();

export const publicCardSchema = z.strictObject({
  public_profile_id: id,
  display_name: z.string(),
  avatar_object_key: z.string().nullable(),
});

const nextCursorSchema = z.strictObject({ sort_key: z.string(), id }).nullable();
const pageOf = <T extends z.ZodType>(item: T) => z.strictObject({ items: z.array(item), next_cursor: nextCursorSchema });

export const friendshipSchema = z.strictObject({
  friendship_id: id,
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "REMOVED"]),
  direction: z.enum(["INCOMING", "OUTGOING"]),
  requested_at: timestamp,
  responded_at: timestamp.nullable(),
  removed_at: timestamp.nullable(),
  counterpart: publicCardSchema.nullable(),
});
export const friendshipPageSchema = pageOf(friendshipSchema);

export const personSearchItemSchema = z.strictObject({
  public_profile_id: id,
  display_name: z.string(),
  avatar_object_key: z.string().nullable(),
  public_stats: z
    .strictObject({
      verified_distance_m: z.number().int().nonnegative(),
      verified_participation_count: z.number().int().nonnegative(),
      achievement_count: z.number().int().nonnegative(),
    })
    .nullable(),
  friendship: z.strictObject({ state: z.enum(FRIENDSHIP_STATES), friendship_id: id.nullable() }),
});
export const personSearchPageSchema = pageOf(personSearchItemSchema);

export const guestSchema = z.strictObject({
  guest_participant_id: id,
  full_name: z.string(),
  date_of_birth: z.iso.date(),
  sex_code: z.enum(SEX_CODES),
  phone_e164: z.string(),
  emergency_contact_name: z.string(),
  emergency_contact_phone_e164: z.string(),
  emergency_contact_relationship: z.string(),
  status: z.enum(GUEST_STATUSES),
  is_minor: z.boolean(),
  identity_locked: z.boolean(),
  guardian_status: z.enum(["NONE", "PENDING", "ACTIVE"]),
  last_event_end_at: timestamp.nullable(),
  archive_after: timestamp.nullable(),
  archived_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export const guestPageSchema = pageOf(guestSchema);

export const guardianAssignmentSchema = z.strictObject({
  guardian_assignment_id: id,
  minor_kind: z.enum(["RUNNER", "GUEST"]),
  my_roles: z.array(z.enum(["MINOR", "GUARDIAN", "GUEST_OWNER"])),
  status: z.enum(GUARDIAN_STATUSES),
  relationship_type: z.string(),
  awaiting_confirmation_by: z.enum(["ME", "COUNTERPART"]).nullable(),
  minor: z
    .union([publicCardSchema, z.strictObject({ guest_participant_id: id.nullable(), full_name: z.string().nullable() })])
    .nullable(),
  guardian: publicCardSchema.nullable(),
  guest_owner: publicCardSchema.nullable(),
  created_at: timestamp,
  activated_at: timestamp.nullable(),
  revoked_at: timestamp.nullable(),
});
export const guardianAssignmentListSchema = z.array(guardianAssignmentSchema);

export const staffGuardianRevocationSchema = z.strictObject({
  guardian_assignment_id: id,
  status: z.literal("REVOKED"),
  revoked_at: timestamp,
});

// ---- Inputs (bodies are strict: unknown fields are rejected, SEC-016) ----

export const idParamsSchema = z.object({ id });

const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min).max(max));

// UI may send formatted numbers; only E.164 reaches the database.
const phoneE164 = z
  .string()
  .max(32)
  .transform((value) => value.replace(/[\s().-]/g, ""))
  .pipe(z.string().regex(E164_PATTERN));

export const guestFieldsSchema = z.strictObject({
  full_name: cleanText(2, 120),
  date_of_birth: z.iso.date(),
  sex_code: z.enum(SEX_CODES),
  phone_e164: phoneE164,
  emergency_contact_name: cleanText(2, 120),
  emergency_contact_phone_e164: phoneE164,
  emergency_contact_relationship: cleanText(1, 60),
});

export const guestPatchSchema = guestFieldsSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field is required" });

export const guestListQuerySchema = z.strictObject({
  status: z.enum(GUEST_STATUSES).default("ACTIVE"),
  cursor: z.string().optional(),
});

export const friendshipCreateSchema = z.strictObject({ public_profile_id: id });

export const friendListQuerySchema = z.strictObject({
  view: z.enum(FRIENDSHIP_VIEWS).default("FRIENDS"),
  cursor: z.string().optional(),
});

export const peopleSearchQuerySchema = z.strictObject({
  q: cleanText(2, 80),
  cursor: z.string().optional(),
});

export const guardianCreateSchema = z.discriminatedUnion("minor_kind", [
  z.strictObject({
    minor_kind: z.literal("RUNNER"),
    counterpart_public_profile_id: id,
    relationship_type: z.enum(GUARDIAN_RELATIONSHIP_TYPES),
  }),
  z.strictObject({
    minor_kind: z.literal("GUEST"),
    guest_participant_id: id,
    // Omitted or null: the guest owner is the guardian.
    guardian_public_profile_id: id.nullable().optional(),
    relationship_type: z.enum(GUARDIAN_RELATIONSHIP_TYPES),
  }),
]);

export const guardianListQuerySchema = z.strictObject({
  include_revoked: z.enum(["true", "false"]).default("false"),
});

export const staffRevokeSchema = z.strictObject({ reason: cleanText(3, 500) });

export const keysetCursorSchema = z.strictObject({ k: z.string().max(400), id });
