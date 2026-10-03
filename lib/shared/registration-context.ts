import { z } from "zod";
import { accountLegalStatusSchema } from "./legal";
import { registrationRequestSchema, type RegistrationRequestView } from "./registration-views";

// Client-safe contract of GET /api/v1/events/:slug/registration-context (Master §34-42, §61-76, §124).
// Pure: no server imports. One server-authoritative read per (signed-in buyer, Edition): the browser
// renders it and never re-derives availability, price, eligibility, documents or the hold. The server
// still revalidates every submission (POST /api/v1/registration-requests), so a stale context is
// rejected with a stable error code, never trusted.
//
// Privacy: no date of birth, age, phone, emergency contact or guardian identity of any person; no
// capacity counts (availability is a state); another person's account state is PARTICIPANT_UNAVAILABLE.

const id = z.guid();
const timestamp = z.string().min(1);
const jsonRecord = z.record(z.string(), z.unknown());

export const AVAILABILITY_STATES = ["AVAILABLE", "LOW", "TEMPORARILY_UNAVAILABLE", "SOLD_OUT"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** Why registration cannot be submitted right now (same precedence as create_registration_request). */
export const REGISTRATION_BLOCKING_CODES = ["EDITION_NOT_REGISTRABLE", "REGISTRATION_CLOSED", "REGISTRATION_NOT_OPEN"] as const;

export const MODALITY_UNAVAILABLE_REASONS = ["MODALITY_CLOSED", "NO_PRICE", "SOLD_OUT", "TEMPORARILY_UNAVAILABLE"] as const;

export const CANDIDATE_RELATIONS = ["SELF", "FRIEND", "WARD", "GUEST"] as const;
export type CandidateRelation = (typeof CANDIDATE_RELATIONS)[number];

/** Who records the event-document acceptance for a candidate (Master §124).
 * SELF: the buyer for themself. OWNER: the buyer for an adult Guest they own. GUARDIAN: the buyer as ACTIVE
 * guardian of a minor. PARTICIPANT: an adult Friend accepts personally (GET/POST /api/v1/me/pending-actions...).
 * OTHER_GUARDIAN: a minor whose ACTIVE guardian is someone else; that guardian accepts. */
export const ACCEPTOR_KINDS = ["SELF", "OWNER", "GUARDIAN", "PARTICIPANT", "OTHER_GUARDIAN"] as const;
export type AcceptorKind = (typeof ACCEPTOR_KINDS)[number];

export const contextPriceSchema = z.strictObject({
  source: z.enum(["FREE", "PRICE_OFFER"]),
  price_offer_id: id.nullable(),
  name: z.string().nullable(),
  /** Minor units of `currency`. FREE is an explicit 0, never inferred from a missing offer. */
  amount_minor: z.number().int(),
  currency: z.string(),
  ends_at: timestamp.nullable(),
});

export const contextModalitySchema = z.strictObject({
  modality_id: id,
  key: z.string(),
  name: z.string(),
  official_distance_m: z.number().int().nullable(),
  local_start_time: z.string().nullable(),
  sort_order: z.number().int(),
  status: z.enum(["ACTIVE", "CLOSED"]),
  /** Derived (confirmed + effective holds vs capacity). TEMPORARILY_UNAVAILABLE (held) is distinct from SOLD_OUT. */
  availability_state: z.enum(AVAILABILITY_STATES),
  registrable: z.boolean(),
  unavailable_reason: z.enum(MODALITY_UNAVAILABLE_REASONS).nullable(),
  price: contextPriceSchema.nullable(),
  /** USER_SELECTS: the buyer picks a category per participant. SYSTEM_DERIVES: the server assigns it. NONE: no category. */
  category_mode: z.enum(["USER_SELECTS", "SYSTEM_DERIVES", "NONE"]),
});

export const contextCategorySchema = z.strictObject({
  category_id: id,
  edition_id: id,
  key: z.string(),
  name: z.string(),
  assignment_mode: z.enum(["USER_SELECTS", "SYSTEM_DERIVES"]),
  /** {min_age?, max_age?, sex_codes?}: informational; the per-candidate verdict below is authoritative. */
  eligibility_rule: jsonRecord,
  active: z.boolean(),
  sort_order: z.number().int(),
  modality_ids: z.array(id),
});

export const FORM_FIELD_TYPES = ["TEXT", "TEXTAREA", "SELECT", "MULTISELECT", "BOOLEAN", "DATE", "NUMBER"] as const;

export const contextFormFieldSchema = z.strictObject({
  field_key: z.string(),
  label: z.string(),
  field_type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean(),
  /** TEXT/TEXTAREA min_length,max_length; NUMBER min,max,integer; DATE min_date,max_date; MULTISELECT min_items,max_items. */
  validation_config: jsonRecord,
  /** SELECT/MULTISELECT: {options: [{value, label}]}. */
  options_config: jsonRecord,
  sort_order: z.number().int(),
});

/** modality_id null = edition-wide form (applies to every participant); otherwise it adds fields for that Modality. */
export const contextFormSchema = z.strictObject({
  registration_form_id: id,
  modality_id: id.nullable(),
  version: z.number().int(),
  fields: z.array(contextFormFieldSchema),
});

export const contextDocumentSchema = z.strictObject({
  document_type: z.enum(["SPORT_WAIVER", "MINOR_TERMS", "EVENT_RULES"]),
  /** Public text: GET /api/v1/legal/:document_key. */
  document_key: z.string(),
  /** ALL: every participant. MINOR: only participants 15-17 (guardian accepts). */
  applies_to: z.enum(["ALL", "MINOR"]),
  legal_document_version_id: id,
  version: z.number().int(),
  published_at: timestamp.nullable(),
});

export const modalityVerdictSchema = z.strictObject({
  modality_id: id,
  eligible: z.boolean(),
  /** Stable error code the server would raise (PARTICIPANT_NOT_ELIGIBLE, GUARDIAN_REQUIRED, DUPLICATE_REGISTRATION,
   * PARTICIPANT_ALREADY_HELD, MODALITY_NOT_AVAILABLE, ACCOUNT_BANNED, IDENTITY_LOCKED, PROFILE_INCOMPLETE, ...); null when eligible. */
  code: z.string().nullable(),
  /** Machine reasons (UNDER_MIN_AGE, NOT_SELF_OR_FRIEND, GUEST_ARCHIVED, GUARDIAN_REQUIRED, MODALITY_RULE, CATEGORY_RULE,
   * NO_CATEGORY_MATCH, PARTICIPANT_UNAVAILABLE, MODALITY_CLOSED, ...). */
  reasons: z.array(z.string()),
  /** True when the buyer must send `category_id` for this participant (pick one of allowed_category_ids). */
  category_selection_required: z.boolean(),
  allowed_category_ids: z.array(id),
  /** SYSTEM_DERIVES: the category the server will assign (informational; do not send it). */
  derived_category_id: id.nullable(),
});

export const candidateSchema = z.strictObject({
  /** Stable key for the UI: "self" | "profile:<public_profile_id>" | "guest:<guest_participant_id>". */
  candidate_key: z.string(),
  relation: z.enum(CANDIDATE_RELATIONS),
  /** Maps 1:1 to participants[].kind of POST /api/v1/registration-requests. */
  participant_kind: z.enum(["PROFILE", "GUEST"]),
  /** Send as participants[].public_profile_id when participant_kind is PROFILE. */
  public_profile_id: id.nullable(),
  /** Send as participants[].guest_participant_id when participant_kind is GUEST. */
  guest_participant_id: id.nullable(),
  display_name: z.string().nullable(),
  is_minor: z.boolean(),
  /** Edition-independent inclusion verdict (Friend/Guest ownership, guardian, age 15+, account state). */
  inclusion: z.strictObject({ eligible: z.boolean(), reasons: z.array(z.string()) }),
  acceptance: z.strictObject({
    /** Event documents this participant needs (current versions). */
    required_document_version_ids: z.array(id),
    /** Required versions with no valid acceptance yet. */
    missing_document_version_ids: z.array(id),
    /** True when the buyer may record the acceptance in the create request (legal_acceptances[]). */
    buyer_can_accept: z.boolean(),
    acceptor: z.enum(ACCEPTOR_KINDS),
  }),
  modalities: z.array(modalityVerdictSchema),
});

const existingRegistrationSchema = z.strictObject({
  registration_id: id,
  registration_number: z.string(),
  status: z.string(),
  registration_request_id: id,
  confirmed_at: timestamp.nullable(),
  is_titular: z.boolean(),
  participant_display_name: z.string().nullable(),
  modality: z.strictObject({ modality_id: id, name: z.string() }),
  /** Present only when the viewer may open that pass (titular, or the owner of a Guest). Never a Friend's pass. */
  participant_pass_id: id.nullable(),
});

const contextEditionSchema = z.strictObject({
  edition_id: id,
  slug: z.string(),
  name: z.string(),
  registration_mode: z.enum(["FREE", "EXTERNAL_WHATSAPP"]),
  registration_state: z.enum(["NOT_OPEN", "OPEN", "PAUSED", "CLOSED"]),
  execution_state: z.enum(["SCHEDULED", "POSTPONED", "IN_PROGRESS", "FINISHED", "CANCELED"]),
  timezone: z.string(),
  sport_date: z.string().nullable(),
  city: z.string(),
  state_region: z.string(),
});

export const registrationContextSchema = z.strictObject({
  redirect: z.literal(false),
  /** Authoritative clock for countdowns; never use the browser clock to decide expiry. */
  server_time: timestamp,
  edition: contextEditionSchema,
  registration: z.strictObject({
    can_register: z.boolean(),
    blocking_code: z.enum(REGISTRATION_BLOCKING_CODES).nullable(),
    opens_at: timestamp.nullable(),
    closes_at: timestamp,
    global_state: z.enum(AVAILABILITY_STATES),
    max_participants_per_request: z.number().int(),
  }),
  /** EXTERNAL_WHATSAPP only (null for FREE): absolute hold, projected expiry min(now + 24 h, registration close). */
  hold: z
    .strictObject({
      kind: z.literal("ABSOLUTE"),
      duration_minutes: z.number().int(),
      extends_on_activity: z.literal(false),
      projected_expires_at: timestamp,
    })
    .nullable(),
  /** EXTERNAL_WHATSAPP only: whether a handoff number is configured. The number itself arrives in the create response. */
  whatsapp: z.strictObject({ configured: z.boolean() }).nullable(),
  modalities: z.array(contextModalitySchema),
  categories: z.array(contextCategorySchema),
  forms: z.array(contextFormSchema),
  documents: z.array(contextDocumentSchema),
  account_legal: accountLegalStatusSchema,
  candidates: z.array(candidateSchema),
  candidates_truncated: z.strictObject({ friends: z.boolean(), guests: z.boolean() }),
  existing: z.strictObject({
    pending_request: registrationRequestSchema.nullable(),
    registrations: z.array(existingRegistrationSchema),
  }),
});
export type RegistrationContextRpc = z.output<typeof registrationContextSchema>;

/** A historical slug: the HTTP route answers 308 to the current slug's registration-context URL. */
export const registrationContextRedirectSchema = z.strictObject({ redirect: z.literal(true), slug: z.string() });

/** What GET /api/v1/events/:slug/registration-context returns in `data`. */
export type RegistrationContext = Omit<RegistrationContextRpc, "existing"> & {
  existing: {
    pending_request: (RegistrationRequestView & { whatsapp_url: string | null }) | null;
    registrations: RegistrationContextRpc["existing"]["registrations"];
  };
};

export type RegistrationCandidate = z.output<typeof candidateSchema>;
export type RegistrationContextModality = z.output<typeof contextModalitySchema>;
export type RegistrationContextForm = z.output<typeof contextFormSchema>;
export type RegistrationContextDocument = z.output<typeof contextDocumentSchema>;
