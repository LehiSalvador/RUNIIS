import { registrationContextSchema, type RegistrationCandidate, type RegistrationContext } from "@/lib/shared/registration-context";

// Synthetic registration contexts for the /inscripcion unit tests. Every fixture is parsed with the real
// P2-B zod contract (strict), so a drift in the server shape breaks these tests instead of the UI.

export const ID = {
  edition: "50000000-0000-4000-8000-0000000c0001",
  m5k: "60000000-0000-4000-8000-0000000c0001",
  m10k: "60000000-0000-4000-8000-0000000c0002",
  catLibre: "62000000-0000-4000-8000-0000000c0001",
  catMaster: "62000000-0000-4000-8000-0000000c0002",
  formWide: "63000000-0000-4000-8000-0000000c0001",
  form10k: "63000000-0000-4000-8000-0000000c0002",
  waiver: "64000000-0000-4000-8000-0000000c0001",
  minorTerms: "64000000-0000-4000-8000-0000000c0002",
  terms: "64000000-0000-4000-8000-0000000c0003",
  privacy: "64000000-0000-4000-8000-0000000c0004",
  selfProfile: "70000000-0000-4000-8000-0000000c0001",
  friendProfile: "70000000-0000-4000-8000-0000000c0002",
  minorProfile: "70000000-0000-4000-8000-0000000c0003",
  guest: "71000000-0000-4000-8000-0000000c0001",
  request: "72000000-0000-4000-8000-0000000c0001",
} as const;

type Verdict = RegistrationCandidate["modalities"][number];

export function verdict(modalityId: string, overrides: Partial<Verdict> = {}): Verdict {
  return {
    modality_id: modalityId,
    eligible: true,
    code: null,
    reasons: [],
    category_selection_required: false,
    allowed_category_ids: [],
    derived_category_id: null,
    ...overrides,
  };
}

export function candidate(overrides: Partial<RegistrationCandidate> & Pick<RegistrationCandidate, "candidate_key" | "relation">): RegistrationCandidate {
  const kind = overrides.relation === "GUEST" ? "GUEST" : "PROFILE";
  return {
    participant_kind: kind,
    public_profile_id: kind === "PROFILE" ? ID.selfProfile : null,
    guest_participant_id: kind === "GUEST" ? ID.guest : null,
    display_name: "Ana Prueba",
    is_minor: false,
    inclusion: { eligible: true, reasons: [] },
    acceptance: { required_document_version_ids: [], missing_document_version_ids: [], buyer_can_accept: true, acceptor: "SELF" },
    modalities: [verdict(ID.m5k), verdict(ID.m10k)],
    ...overrides,
  };
}

export function baseContext(mode: "FREE" | "EXTERNAL_WHATSAPP" = "FREE", patch: Record<string, unknown> = {}): RegistrationContext {
  const whatsapp = mode === "EXTERNAL_WHATSAPP";
  const raw = {
    redirect: false,
    server_time: "2026-10-03T12:00:00+00:00",
    edition: {
      edition_id: ID.edition,
      slug: whatsapp ? "demo-whatsapp" : "demo-gratis",
      name: whatsapp ? "Demo WhatsApp 10K" : "Demo Gratis 5K/10K",
      registration_mode: mode,
      registration_state: "OPEN",
      execution_state: "SCHEDULED",
      timezone: "America/Monterrey",
      sport_date: "2026-12-02",
      city: "Monterrey",
      state_region: "NL",
    },
    registration: { can_register: true, blocking_code: null, opens_at: "2026-09-01T12:00:00+00:00", closes_at: "2026-11-30T12:00:00+00:00", global_state: "AVAILABLE", max_participants_per_request: 20 },
    hold: whatsapp ? { kind: "ABSOLUTE", duration_minutes: 1440, extends_on_activity: false, projected_expires_at: "2026-10-04T12:00:00+00:00" } : null,
    whatsapp: whatsapp ? { configured: true } : null,
    modalities: [
      { modality_id: ID.m5k, key: "5k", name: "5K", official_distance_m: 5000, local_start_time: "07:00:00", sort_order: 1, status: "ACTIVE", availability_state: "AVAILABLE", registrable: true, unavailable_reason: null, price: { source: whatsapp ? "PRICE_OFFER" : "FREE", price_offer_id: null, name: null, amount_minor: whatsapp ? 25000 : 0, currency: "MXN", ends_at: null }, category_mode: "NONE" },
      { modality_id: ID.m10k, key: "10k", name: "10K", official_distance_m: 10000, local_start_time: "07:15:00", sort_order: 2, status: "ACTIVE", availability_state: "AVAILABLE", registrable: true, unavailable_reason: null, price: { source: whatsapp ? "PRICE_OFFER" : "FREE", price_offer_id: null, name: null, amount_minor: whatsapp ? 35000 : 0, currency: "MXN", ends_at: null }, category_mode: "USER_SELECTS" },
    ],
    categories: [
      { category_id: ID.catLibre, edition_id: ID.edition, key: "libre", name: "Libre", assignment_mode: "USER_SELECTS", eligibility_rule: {}, active: true, sort_order: 1, modality_ids: [ID.m10k] },
      { category_id: ID.catMaster, edition_id: ID.edition, key: "master", name: "Máster 40+", assignment_mode: "USER_SELECTS", eligibility_rule: { min_age: 40 }, active: true, sort_order: 2, modality_ids: [ID.m10k] },
    ],
    forms: [
      {
        registration_form_id: ID.formWide,
        modality_id: null,
        version: 1,
        fields: [
          { field_key: "shirt_size", label: "Talla de playera", field_type: "SELECT", required: true, validation_config: {}, options_config: { options: [{ value: "S", label: "S" }, { value: "M", label: "M" }] }, sort_order: 1 },
          { field_key: "club", label: "Club", field_type: "TEXT", required: false, validation_config: { max_length: 10 }, options_config: {}, sort_order: 2 },
        ],
      },
      {
        registration_form_id: ID.form10k,
        modality_id: ID.m10k,
        version: 1,
        fields: [{ field_key: "pace", label: "Ritmo (min/km)", field_type: "NUMBER", required: false, validation_config: { min: 3, max: 12 }, options_config: {}, sort_order: 1 }],
      },
    ],
    documents: [],
    account_legal: { needs_acceptance: false, needs_reacceptance: false, missing_document_version_ids: [], documents: [] },
    candidates: [
      candidate({
        candidate_key: "self",
        relation: "SELF",
        display_name: "Ana Prueba",
        modalities: [verdict(ID.m5k), verdict(ID.m10k, { category_selection_required: true, allowed_category_ids: [ID.catLibre] })],
      }),
    ],
    candidates_truncated: { friends: false, guests: false },
    existing: { pending_request: null, registrations: [] },
  };
  return registrationContextSchema.parse({ ...raw, ...patch }) as unknown as RegistrationContext;
}

export const WAIVER_DOC = { document_type: "SPORT_WAIVER", document_key: "SPORT_WAIVER", applies_to: "ALL", legal_document_version_id: ID.waiver, version: 3, published_at: "2026-09-01T12:00:00+00:00" } as const;
export const MINOR_DOC = { document_type: "MINOR_TERMS", document_key: "MINOR_TERMS", applies_to: "MINOR", legal_document_version_id: ID.minorTerms, version: 1, published_at: "2026-09-01T12:00:00+00:00" } as const;

/** Context with a Friend (adult, personal acceptance pending), a Guest, a ward minor and one ineligible Friend. */
export function peopleContext(mode: "FREE" | "EXTERNAL_WHATSAPP" = "FREE"): RegistrationContext {
  const base = baseContext(mode);
  const self = candidate({
    candidate_key: "self",
    relation: "SELF",
    display_name: "Ana Prueba",
    acceptance: { required_document_version_ids: [ID.waiver], missing_document_version_ids: [ID.waiver], buyer_can_accept: true, acceptor: "SELF" },
    modalities: [verdict(ID.m5k), verdict(ID.m10k, { category_selection_required: true, allowed_category_ids: [ID.catLibre] })],
  });
  const friend = candidate({
    candidate_key: `profile:${ID.friendProfile}`,
    relation: "FRIEND",
    public_profile_id: ID.friendProfile,
    display_name: "Beto Amigo",
    acceptance: { required_document_version_ids: [ID.waiver], missing_document_version_ids: [ID.waiver], buyer_can_accept: false, acceptor: "PARTICIPANT" },
    modalities: [verdict(ID.m5k), verdict(ID.m10k, { category_selection_required: true, allowed_category_ids: [ID.catLibre] })],
  });
  const guest = candidate({
    candidate_key: `guest:${ID.guest}`,
    relation: "GUEST",
    display_name: "Caro Invitada",
    acceptance: { required_document_version_ids: [ID.waiver], missing_document_version_ids: [ID.waiver], buyer_can_accept: true, acceptor: "OWNER" },
    modalities: [verdict(ID.m5k), verdict(ID.m10k, { eligible: false, code: "PARTICIPANT_NOT_ELIGIBLE", reasons: ["MODALITY_RULE"] })],
  });
  const minor = candidate({
    candidate_key: `profile:${ID.minorProfile}`,
    relation: "WARD",
    public_profile_id: ID.minorProfile,
    display_name: "Dani Menor",
    is_minor: true,
    inclusion: { eligible: false, reasons: ["GUARDIAN_REQUIRED"] },
    modalities: [],
  });
  return baseContextWith(base, {
    documents: [WAIVER_DOC, MINOR_DOC],
    candidates: [self, friend, guest, minor],
  });
}

function baseContextWith(base: RegistrationContext, patch: Partial<RegistrationContext>): RegistrationContext {
  return registrationContextSchema.parse({ ...base, ...patch }) as unknown as RegistrationContext;
}
