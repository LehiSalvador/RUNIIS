import { z } from "zod";

// Client-safe contract of account-level legal acceptance (OWN-05, Master §123-124, §16 step 9b).
// Pure: no server imports. TERMS_OF_SERVICE and PRIVACY_NOTICE are accepted once in onboarding and
// re-accepted whenever a newer version is published; event documents (SPORT_WAIVER, EVENT_RULES,
// MINOR_TERMS) are NOT part of this contract (they are per registration and per participant).

export const ACCOUNT_LEGAL_DOCUMENT_TYPES = ["TERMS_OF_SERVICE", "PRIVACY_NOTICE"] as const;
export type AccountLegalDocumentType = (typeof ACCOUNT_LEGAL_DOCUMENT_TYPES)[number];

/** ACCEPTED: current version accepted. NEW_VERSION: an older version was accepted, the current one was not.
 * NEVER_ACCEPTED: no version of that document was ever accepted. */
export const ACCOUNT_LEGAL_STATUSES = ["ACCEPTED", "NEW_VERSION", "NEVER_ACCEPTED"] as const;
export type AccountLegalDocumentStatus = (typeof ACCOUNT_LEGAL_STATUSES)[number];

const id = z.guid();
const timestamp = z.string().min(1);

export const accountLegalDocumentSchema = z.strictObject({
  document_type: z.enum(ACCOUNT_LEGAL_DOCUMENT_TYPES),
  /** Path segment of GET /api/v1/legal/:documentKey (public text of the current version). */
  document_key: z.string(),
  legal_document_version_id: id,
  version: z.number().int(),
  published_at: timestamp.nullable(),
  status: z.enum(ACCOUNT_LEGAL_STATUSES),
  accepted_at: timestamp.nullable(),
  accepted_version: z.number().int().nullable(),
});

export const accountLegalStatusSchema = z.strictObject({
  /** True when at least one current document is not ACCEPTED (first acceptance or re-acceptance). */
  needs_acceptance: z.boolean(),
  /** True when at least one current document is NEW_VERSION (the user accepted an older version). */
  needs_reacceptance: z.boolean(),
  missing_document_version_ids: z.array(id),
  documents: z.array(accountLegalDocumentSchema),
});
export type AccountLegalStatus = z.output<typeof accountLegalStatusSchema>;

/** Response of GET /api/v1/me/legal and POST /api/v1/me/legal/accept. */
export const accountLegalStatusResponseSchema = accountLegalStatusSchema.extend({ server_time: timestamp });
export type AccountLegalStatusResponse = z.output<typeof accountLegalStatusResponseSchema>;

/** Body of POST /api/v1/me/legal/accept: the version ids the client displayed (all must be current). */
export const acceptAccountLegalBodySchema = z.strictObject({
  legal_document_version_ids: z.array(id).min(1).max(10),
});
export type AcceptAccountLegalBody = z.output<typeof acceptAccountLegalBodySchema>;

/** `details.reason` values of LEGAL_ACCEPTANCE_REQUIRED with `details.scope === "ACCOUNT"`. */
export const ACCOUNT_LEGAL_ERROR_REASONS = ["ACCOUNT_DOCUMENTS", "VERSION_NOT_CURRENT", "MISSING_DOCUMENTS"] as const;
