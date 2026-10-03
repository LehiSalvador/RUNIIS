import "server-only";
import { z } from "zod";
import { STAFF_ROLES } from "@/lib/server/auth/actor";

// Output schemas are strict: an unexpected key from the DB fails closed as INTERNAL_ERROR instead
// of reaching the client (same posture as the people domain, SEC-120).

const timestamp = z.string().min(1);
const id = z.uuid();

const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;

export const communitySchema = z.strictObject({
  public_profile_id: id,
  display_name: z.string(),
  competition_status: z.enum(["ELIGIBLE", "MINOR_NONCOMPETITIVE", "SUSPENDED", "INELIGIBLE"]),
  is_visible: z.boolean(),
  is_searchable: z.boolean(),
});

export const myProfileSchema = z.strictObject({
  runner_profile_id: id,
  profile_readiness: z.enum(["PROFILE_INCOMPLETE", "READY"]),
  account_state: z.enum(["ACTIVE", "IDENTITY_LOCKED", "BANNED", "DEACTIVATED"]),
  full_name: z.string().nullable(),
  date_of_birth: z.iso.date().nullable(),
  sex_code: z.enum(["F", "M", "X"]).nullable(),
  phone_e164: z.string().nullable(),
  emergency_contact_name: z.string().nullable(),
  emergency_contact_phone_e164: z.string().nullable(),
  emergency_contact_relationship: z.string().nullable(),
  ready_at: timestamp.nullable(),
  community: communitySchema.nullable(),
});

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

export const onboardingSchema = z.strictObject({
  full_name: cleanText(2, 120),
  date_of_birth: z.iso.date(),
  sex_code: z.enum(["F", "M", "X"]),
  phone_e164: phoneE164,
  emergency_contact_name: cleanText(2, 120),
  emergency_contact_phone_e164: phoneE164,
  emergency_contact_relationship: cleanText(1, 60),
  /**
   * OWN-05: the TERMS_OF_SERVICE / PRIVACY_NOTICE version ids the user was shown and accepted. When present
   * they must be exactly the current published versions (LEGAL_ACCEPTANCE_REQUIRED otherwise); when absent the
   * server records the current ones (legacy behaviour, Master §16 step 9b). The UI should always send it.
   */
  legal_document_version_ids: z.array(id).max(10).optional(),
});

export const profilePatchSchema = z
  .strictObject({
    phone_e164: phoneE164.optional(),
    emergency_contact_name: cleanText(2, 120).optional(),
    emergency_contact_phone_e164: phoneE164.optional(),
    emergency_contact_relationship: cleanText(1, 60).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "At least one field is required" });

// ---- Auth flow (OTP request/verify, Master §17) ----

// Case varies the SUPPLIED-subject rate-limit bucket (private.consume_subject_rate_limit hashes the
// raw subject) but never the account GoTrue resolves to; normalizing here keeps "User@x.test" and
// "user@x.test" in the same OTP-spam/brute-force bucket (SEC-041/043), matching
// private.blocked_identity's own normalized_email comparison.
const normalizedEmail = z
  .email()
  .max(320)
  .transform((value) => value.trim().toLowerCase());

export const otpRequestSchema = z.strictObject({ email: normalizedEmail });
export const otpVerifySchema = z.strictObject({
  email: normalizedEmail,
  code: z.string().regex(/^[0-9]{6}$/),
});

// ---- Staff role management (Master §144-145, ADMIN GLOBAL only) ----

export const staffRoleAssignmentSchema = z.strictObject({
  staff_role_assignment_id: id,
  role: z.enum(STAFF_ROLES),
  scope_type: z.enum(["GLOBAL", "EDITION"]),
  edition_id: id.nullable(),
  created_at: timestamp,
  revoked_at: timestamp.nullable(),
});

export const staffMemberSchema = z.strictObject({
  staff_member_id: id,
  auth_user_id: id,
  status: z.enum(["ACTIVE", "REVOKED"]),
  full_name: z.string().nullable(),
  roles: z.array(staffRoleAssignmentSchema),
});
export const staffRosterSchema = z.array(staffMemberSchema);

export const staffGrantSchema = z.strictObject({
  staff_role_assignment_id: id,
  staff_member_id: id,
  role: z.enum(STAFF_ROLES),
  scope_type: z.enum(["GLOBAL", "EDITION"]),
  edition_id: id.nullable(),
});

export const staffRevokeResultSchema = z.strictObject({
  staff_role_assignment_id: id,
  status: z.literal("REVOKED"),
  revoked_at: timestamp,
});

export const staffGrantBodySchema = z.strictObject({
  email: z.email().max(320),
  role: z.enum(STAFF_ROLES),
  scope_type: z.enum(["GLOBAL", "EDITION"]),
  edition_id: id.nullable().optional(),
});

export const staffRoleParamsSchema = z.object({ id });
