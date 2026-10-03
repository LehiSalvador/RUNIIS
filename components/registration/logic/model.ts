import type { CreateRegistrationRequestBody } from "@/lib/shared/registration";
import type {
  RegistrationCandidate,
  RegistrationContext,
  RegistrationContextDocument,
  RegistrationContextForm,
  RegistrationContextModality,
} from "@/lib/shared/registration-context";
import { fieldReasonMessage, reasonsMessage, UNAVAILABLE_REASON_LABELS, verdictMessage, type FieldConstraints } from "./copy";

// Pure model of the registration builder. The browser keeps ONLY the buyer's choices (who, which
// modality/category, form answers, ticked event documents). Availability, price, eligibility,
// categories, forms and required documents are read from the server context every time; nothing
// here decides them. The server revalidates the whole submission (POST /api/v1/registration-requests).

export type FieldValue = string | boolean | string[];
export type ParticipantDraft = {
  modalityId: string | null;
  categoryId: string | null;
  /** Raw answers as typed: NUMBER stays a string until the payload is built. */
  responses: Record<string, FieldValue>;
  /** legal_document_version_id values the buyer ticked for this participant. */
  accepted: string[];
};
export type Draft = { selected: string[]; participants: Record<string, ParticipantDraft> };

type Verdict = RegistrationCandidate["modalities"][number];
type FormField = RegistrationContextForm["fields"][number];

export const STEP_IDS = ["participants", "details", "legal", "review"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const STEP_LABELS: Record<StepId, string> = {
  participants: "Participantes",
  details: "Modalidad y datos",
  legal: "Legal",
  review: "Revisión",
};

export function emptyParticipantDraft(): ParticipantDraft {
  return { modalityId: null, categoryId: null, responses: {}, accepted: [] };
}

export function candidateOf(ctx: RegistrationContext, key: string): RegistrationCandidate | undefined {
  return ctx.candidates.find((candidate) => candidate.candidate_key === key);
}

export function modalityOf(ctx: RegistrationContext, id: string | null): RegistrationContextModality | undefined {
  return id ? ctx.modalities.find((modality) => modality.modality_id === id) : undefined;
}

export function verdictOf(candidate: RegistrationCandidate, modalityId: string): Verdict | undefined {
  return candidate.modalities.find((verdict) => verdict.modality_id === modalityId);
}

// ---- Eligibility (read from the server's per-candidate verdicts) ----

export type OptionState = { selectable: boolean; reason: string | null };

/** One modality for one candidate: capacity/price/closure come from the modality, rules from the verdict. */
export function modalityOption(candidate: RegistrationCandidate, modality: RegistrationContextModality): OptionState {
  if (!modality.registrable) {
    const label = modality.unavailable_reason ? UNAVAILABLE_REASON_LABELS[modality.unavailable_reason] : "No disponible";
    return { selectable: false, reason: label };
  }
  const verdict = verdictOf(candidate, modality.modality_id);
  if (!verdict) return { selectable: false, reason: "Esta modalidad no está disponible para esta persona." };
  if (!verdict.eligible) return { selectable: false, reason: verdictMessage(verdict, candidate.relation === "SELF") };
  return { selectable: true, reason: null };
}

/** A candidate can be added when the person is includable and at least one modality is open to them. */
export function candidateState(ctx: RegistrationContext, candidate: RegistrationCandidate): OptionState {
  if (!candidate.inclusion.eligible) return { selectable: false, reason: reasonsMessage(candidate.inclusion.reasons) };
  const options = ctx.modalities.map((modality) => ({ modality, state: modalityOption(candidate, modality) }));
  if (options.some((option) => option.state.selectable)) return { selectable: true, reason: null };
  // Why nothing is open: personal verdicts first (duplicate/held/age) so the reason names the person, then capacity.
  const personal = candidate.modalities.find((verdict) => !verdict.eligible && verdict.code && verdict.code !== "MODALITY_NOT_AVAILABLE");
  if (personal) return { selectable: false, reason: verdictMessage(personal, candidate.relation === "SELF") };
  const firstReason = options.find((option) => option.state.reason)?.state.reason;
  return { selectable: false, reason: firstReason ? `Sin lugares disponibles: ${firstReason.toLowerCase()}.` : "No hay modalidades disponibles." };
}

export function selectableModalities(ctx: RegistrationContext, candidate: RegistrationCandidate): RegistrationContextModality[] {
  return ctx.modalities.filter((modality) => modalityOption(candidate, modality).selectable);
}

/** No modality can be registered by anyone right now (sold out, held, closed, no price). */
export function noRegistrableModality(ctx: RegistrationContext): boolean {
  return ctx.modalities.every((modality) => !modality.registrable);
}

// ---- Categories ----

export type CategoryChoice = { category_id: string; name: string };

export function categoryChoices(ctx: RegistrationContext, candidate: RegistrationCandidate, modalityId: string): CategoryChoice[] {
  const verdict = verdictOf(candidate, modalityId);
  if (!verdict) return [];
  const allowed = new Set(verdict.allowed_category_ids);
  return ctx.categories
    .filter((category) => allowed.has(category.category_id))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((category) => ({ category_id: category.category_id, name: category.name }));
}

export function derivedCategoryName(ctx: RegistrationContext, candidate: RegistrationCandidate, modalityId: string): string | null {
  const id = verdictOf(candidate, modalityId)?.derived_category_id;
  return id ? (ctx.categories.find((category) => category.category_id === id)?.name ?? null) : null;
}

export function categoryRequired(candidate: RegistrationCandidate, modality: RegistrationContextModality | undefined): boolean {
  if (!modality) return false;
  const verdict = verdictOf(candidate, modality.modality_id);
  return modality.category_mode === "USER_SELECTS" && Boolean(verdict?.category_selection_required);
}

// ---- Dynamic form (server definition, no invented conditional logic) ----

/** Edition-wide fields first, then the modality's own; a repeated key keeps its first definition. */
export function fieldsFor(ctx: RegistrationContext, modalityId: string | null): FormField[] {
  const forms = ctx.forms
    .filter((form) => form.modality_id === null || form.modality_id === modalityId)
    .sort((a, b) => (a.modality_id === null ? -1 : 0) - (b.modality_id === null ? -1 : 0));
  const seen = new Set<string>();
  const fields: FormField[] = [];
  for (const form of forms) {
    for (const field of [...form.fields].sort((a, b) => a.sort_order - b.sort_order)) {
      if (seen.has(field.field_key)) continue;
      seen.add(field.field_key);
      fields.push(field);
    }
  }
  return fields;
}

export type FieldOption = { value: string; label: string };

export function fieldOptions(field: FormField): FieldOption[] {
  const raw = (field.options_config as { options?: unknown }).options;
  if (!Array.isArray(raw)) return [];
  const options: FieldOption[] = [];
  for (const item of raw) {
    if (typeof item === "string") options.push({ value: item, label: item });
    else if (item && typeof item === "object") {
      const { value, label } = item as { value?: unknown; label?: unknown };
      if (typeof value === "string") options.push({ value, label: typeof label === "string" && label ? label : value });
    }
  }
  return options;
}

export function fieldConstraints(field: FormField): FieldConstraints {
  const config = field.validation_config as Record<string, unknown>;
  const num = (key: string) => (typeof config[key] === "number" ? (config[key] as number) : undefined);
  const str = (key: string) => (typeof config[key] === "string" ? (config[key] as string) : undefined);
  return {
    min_length: num("min_length"),
    max_length: num("max_length"),
    min: num("min"),
    max: num("max"),
    min_date: str("min_date"),
    max_date: str("max_date"),
    min_items: num("min_items"),
    max_items: num("max_items"),
  };
}

function isEmpty(value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/** UX-only mirror of the server rules (registration_field_value_error): the server stays authoritative. */
export function validateField(field: FormField, value: FieldValue | undefined): string | null {
  const constraints = fieldConstraints(field);
  if (isEmpty(value)) return field.required ? fieldReasonMessage("required") : null;
  switch (field.field_type) {
    case "TEXT":
    case "TEXTAREA": {
      if (typeof value !== "string") return fieldReasonMessage("invalid_type");
      const length = value.trim().length;
      if (length < (constraints.min_length ?? 0)) return fieldReasonMessage("too_short", constraints);
      if (length > (constraints.max_length ?? (field.field_type === "TEXT" ? 200 : 2000))) return fieldReasonMessage("too_long", constraints);
      return null;
    }
    case "SELECT":
      return typeof value === "string" && fieldOptions(field).some((option) => option.value === value) ? null : fieldReasonMessage("invalid_option");
    case "MULTISELECT": {
      if (!Array.isArray(value)) return fieldReasonMessage("invalid_type");
      const options = new Set(fieldOptions(field).map((option) => option.value));
      if (value.some((item) => !options.has(item))) return fieldReasonMessage("invalid_option");
      const count = value.length;
      const min = constraints.min_items ?? 0;
      const max = constraints.max_items ?? options.size;
      if (count < min || count > max) return fieldReasonMessage("invalid_item_count", { min_items: min, max_items: max });
      return field.required && count === 0 ? fieldReasonMessage("required") : null;
    }
    case "BOOLEAN":
      return typeof value === "boolean" ? null : fieldReasonMessage("invalid_type");
    case "DATE":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return fieldReasonMessage("invalid_date");
      if ((constraints.min_date && value < constraints.min_date) || (constraints.max_date && value > constraints.max_date)) return fieldReasonMessage("out_of_range", constraints);
      return null;
    case "NUMBER": {
      if (typeof value !== "string") return fieldReasonMessage("invalid_type");
      const number = Number(value.replace(",", "."));
      if (!Number.isFinite(number)) return fieldReasonMessage("invalid_type");
      const config = field.validation_config as { integer?: unknown };
      if (config.integer === true && !Number.isInteger(number)) return fieldReasonMessage("not_integer");
      if ((constraints.min !== undefined && number < constraints.min) || (constraints.max !== undefined && number > constraints.max)) return fieldReasonMessage("out_of_range", constraints);
      return null;
    }
  }
}

// ---- Draft operations ----

export function maxParticipants(ctx: RegistrationContext): number {
  return ctx.registration.max_participants_per_request;
}

export function ensureParticipant(draft: Draft, key: string): ParticipantDraft {
  return draft.participants[key] ?? emptyParticipantDraft();
}

/** Single open modality and single allowed category are preselected: a convenience, still revalidated. */
function applyDefaults(ctx: RegistrationContext, candidate: RegistrationCandidate, current: ParticipantDraft): ParticipantDraft {
  let next = current;
  if (!next.modalityId) {
    const open = selectableModalities(ctx, candidate);
    if (open.length === 1) next = { ...next, modalityId: open[0].modality_id };
  }
  const modality = modalityOf(ctx, next.modalityId);
  if (modality && !next.categoryId && categoryRequired(candidate, modality)) {
    const choices = categoryChoices(ctx, candidate, modality.modality_id);
    if (choices.length === 1) next = { ...next, categoryId: choices[0].category_id };
  }
  return next;
}

export function orderedSelection(ctx: RegistrationContext, draft: Draft): RegistrationCandidate[] {
  const wanted = new Set(draft.selected);
  return ctx.candidates.filter((candidate) => wanted.has(candidate.candidate_key));
}

export function toggleCandidate(ctx: RegistrationContext, draft: Draft, key: string, on: boolean): Draft {
  const candidate = candidateOf(ctx, key);
  const present = draft.selected.includes(key);
  if (!candidate) return draft;
  if (!on) {
    if (!present) return draft;
    return { ...draft, selected: draft.selected.filter((item) => item !== key) };
  }
  if (present || !candidateState(ctx, candidate).selectable || draft.selected.length >= maxParticipants(ctx)) return draft;
  const participant = applyDefaults(ctx, candidate, ensureParticipant(draft, key));
  return { selected: [...draft.selected, key], participants: { ...draft.participants, [key]: participant } };
}

function pruneResponses(ctx: RegistrationContext, modalityId: string | null, responses: Record<string, FieldValue>): Record<string, FieldValue> {
  const keys = new Set(fieldsFor(ctx, modalityId).map((field) => field.field_key));
  return Object.fromEntries(Object.entries(responses).filter(([key]) => keys.has(key)));
}

export function setModality(ctx: RegistrationContext, draft: Draft, key: string, modalityId: string): Draft {
  const candidate = candidateOf(ctx, key);
  const modality = modalityOf(ctx, modalityId);
  if (!candidate || !modality || !modalityOption(candidate, modality).selectable) return draft;
  const current = ensureParticipant(draft, key);
  if (current.modalityId === modalityId) return draft;
  const next = applyDefaults(ctx, candidate, {
    ...current,
    modalityId,
    categoryId: null,
    responses: pruneResponses(ctx, modalityId, current.responses),
  });
  return { ...draft, participants: { ...draft.participants, [key]: next } };
}

export function setCategory(draft: Draft, key: string, categoryId: string | null): Draft {
  return { ...draft, participants: { ...draft.participants, [key]: { ...ensureParticipant(draft, key), categoryId } } };
}

export function setResponse(draft: Draft, key: string, fieldKey: string, value: FieldValue | undefined): Draft {
  const current = ensureParticipant(draft, key);
  const responses = { ...current.responses };
  if (value === undefined) delete responses[fieldKey];
  else responses[fieldKey] = value;
  return { ...draft, participants: { ...draft.participants, [key]: { ...current, responses } } };
}

export function setAccepted(draft: Draft, key: string, versionId: string, accepted: boolean): Draft {
  const current = ensureParticipant(draft, key);
  const rest = current.accepted.filter((id) => id !== versionId);
  return { ...draft, participants: { ...draft.participants, [key]: { ...current, accepted: accepted ? [...rest, versionId] : rest } } };
}

/** Initial draft: the buyer pre-selected when they can register themselves (a convenience, not a decision). */
export function initialDraft(ctx: RegistrationContext): Draft {
  const empty: Draft = { selected: [], participants: {} };
  const self = ctx.candidates.find((candidate) => candidate.relation === "SELF");
  return self ? toggleCandidate(ctx, empty, self.candidate_key, true) : empty;
}

/**
 * Reconciles a draft with a fresh context (after a stale-state error or a manual refresh): anything the
 * server no longer offers is dropped; nothing is invented. Typed answers survive when their field still exists.
 */
export function reconcileDraft(ctx: RegistrationContext, draft: Draft): Draft {
  const selected: string[] = [];
  const participants: Record<string, ParticipantDraft> = {};
  for (const key of draft.selected) {
    const candidate = candidateOf(ctx, key);
    if (!candidate || !candidateState(ctx, candidate).selectable || selected.length >= maxParticipants(ctx)) continue;
    selected.push(key);
    const old = ensureParticipant(draft, key);
    let modalityId = old.modalityId;
    const modality = modalityOf(ctx, modalityId);
    if (!modality || !modalityOption(candidate, modality).selectable) modalityId = null;
    let categoryId = old.categoryId;
    if (!modalityId || !categoryChoices(ctx, candidate, modalityId).some((choice) => choice.category_id === categoryId)) categoryId = null;
    const required = new Set(candidate.acceptance.required_document_version_ids);
    participants[key] = applyDefaults(ctx, candidate, {
      modalityId,
      categoryId,
      responses: pruneResponses(ctx, modalityId, old.responses),
      accepted: old.accepted.filter((id) => required.has(id)),
    });
  }
  return { selected, participants };
}

// ---- Step validation ----

export type DetailsErrors = Record<string, { modality?: string; category?: string; fields: Record<string, string> }>;

export function validateDetails(ctx: RegistrationContext, draft: Draft): DetailsErrors {
  const errors: DetailsErrors = {};
  for (const candidate of orderedSelection(ctx, draft)) {
    const key = candidate.candidate_key;
    const participant = ensureParticipant(draft, key);
    const entry: DetailsErrors[string] = { fields: {} };
    const modality = modalityOf(ctx, participant.modalityId);
    if (!modality) entry.modality = "Elige una modalidad.";
    else if (!modalityOption(candidate, modality).selectable) entry.modality = "Esta modalidad ya no está disponible para esta persona. Elige otra.";
    if (modality && !entry.modality) {
      if (categoryRequired(candidate, modality)) {
        const choices = categoryChoices(ctx, candidate, modality.modality_id);
        if (!participant.categoryId || !choices.some((choice) => choice.category_id === participant.categoryId)) entry.category = "Elige una categoría.";
      }
      for (const field of fieldsFor(ctx, modality.modality_id)) {
        const message = validateField(field, participant.responses[field.field_key]);
        if (message) entry.fields[field.field_key] = message;
      }
    }
    if (entry.modality || entry.category || Object.keys(entry.fields).length > 0) errors[key] = entry;
  }
  return errors;
}

export function participantsStepError(ctx: RegistrationContext, draft: Draft): string | null {
  if (draft.selected.length === 0) return "Elige al menos un participante.";
  if (draft.selected.length > maxParticipants(ctx)) return `Una solicitud admite máximo ${maxParticipants(ctx)} participantes.`;
  return null;
}

// ---- Legal ----

export type DocumentRow = {
  versionId: string;
  document: RegistrationContextDocument | null;
  missing: boolean;
  checked: boolean;
};

export type LegalRow = {
  candidate: RegistrationCandidate;
  documents: DocumentRow[];
  /** Missing documents the buyer cannot tick (adult Friend, minor of another guardian). */
  pendingOther: boolean;
  /** Missing documents the buyer still has to tick. */
  pendingBuyer: boolean;
};

export function documentOf(ctx: RegistrationContext, versionId: string): RegistrationContextDocument | null {
  return ctx.documents.find((document) => document.legal_document_version_id === versionId) ?? null;
}

export function legalRows(ctx: RegistrationContext, draft: Draft): LegalRow[] {
  return orderedSelection(ctx, draft).map((candidate) => {
    const participant = ensureParticipant(draft, candidate.candidate_key);
    const missing = new Set(candidate.acceptance.missing_document_version_ids);
    const documents: DocumentRow[] = candidate.acceptance.required_document_version_ids.map((versionId) => ({
      versionId,
      document: documentOf(ctx, versionId),
      missing: missing.has(versionId),
      checked: participant.accepted.includes(versionId),
    }));
    const stillMissing = documents.filter((row) => row.missing);
    const canAccept = candidate.acceptance.buyer_can_accept;
    return {
      candidate,
      documents,
      pendingOther: !canAccept && stillMissing.length > 0,
      pendingBuyer: canAccept && stillMissing.some((row) => !row.checked),
    };
  });
}

export type LegalStatus = {
  accountPending: boolean;
  rows: LegalRow[];
  /** Participants whose documents someone else must accept. */
  pendingOthers: RegistrationCandidate[];
  buyerBoxesPending: number;
  /** FREE confirms in one transaction, so every other person's acceptance must exist before submit (T12 J1 step 4). */
  blockedByOthers: boolean;
  complete: boolean;
};

export function legalStatus(ctx: RegistrationContext, draft: Draft): LegalStatus {
  const rows = legalRows(ctx, draft);
  const accountPending = ctx.account_legal.needs_acceptance;
  const pendingOthers = rows.filter((row) => row.pendingOther).map((row) => row.candidate);
  const buyerBoxesPending = rows.reduce((sum, row) => sum + row.documents.filter((doc) => doc.missing && !doc.checked && row.candidate.acceptance.buyer_can_accept).length, 0);
  const blockedByOthers = ctx.edition.registration_mode === "FREE" && pendingOthers.length > 0;
  return {
    accountPending,
    rows,
    pendingOthers,
    buyerBoxesPending,
    blockedByOthers,
    complete: !accountPending && buyerBoxesPending === 0 && !blockedByOthers,
  };
}

// ---- Payload and estimate ----

export function buildCreateBody(ctx: RegistrationContext, draft: Draft): CreateRegistrationRequestBody {
  const participants: CreateRegistrationRequestBody["participants"] = [];
  const legalAcceptances: CreateRegistrationRequestBody["legal_acceptances"] = [];
  for (const candidate of orderedSelection(ctx, draft)) {
    const state = ensureParticipant(draft, candidate.candidate_key);
    const modality = modalityOf(ctx, state.modalityId);
    if (!modality) continue;
    const index = participants.length;
    const responses: Record<string, string | number | boolean | string[]> = {};
    for (const field of fieldsFor(ctx, modality.modality_id)) {
      const value = state.responses[field.field_key];
      if (value === undefined || (typeof value === "string" && value.trim() === "")) continue;
      if (field.field_type === "NUMBER" && typeof value === "string") responses[field.field_key] = Number(value.replace(",", "."));
      else if (typeof value === "string") responses[field.field_key] = value.trim();
      else responses[field.field_key] = value;
    }
    const wantsCategory = categoryRequired(candidate, modality) && state.categoryId;
    participants.push({
      kind: candidate.participant_kind,
      ...(candidate.participant_kind === "PROFILE" ? { public_profile_id: candidate.public_profile_id ?? undefined } : { guest_participant_id: candidate.guest_participant_id ?? undefined }),
      modality_id: modality.modality_id,
      ...(wantsCategory ? { category_id: state.categoryId as string } : {}),
      ...(Object.keys(responses).length > 0 ? { responses } : {}),
    });
    if (candidate.acceptance.buyer_can_accept) {
      const missing = new Set(candidate.acceptance.missing_document_version_ids);
      for (const versionId of state.accepted) {
        if (missing.has(versionId)) legalAcceptances.push({ participant_index: index, legal_document_version_id: versionId });
      }
    }
  }
  return { edition_id: ctx.edition.edition_id, participants, legal_acceptances: legalAcceptances };
}

/** Indices in the body line up with `orderedSelection` only while every selected candidate has a modality. */
export function bodySignature(body: CreateRegistrationRequestBody): string {
  return JSON.stringify(body);
}

export type PriceEstimate = { amountMinor: number; currency: string } | null;

/**
 * Display-only sum of the modality prices the server returned (P2-B contract §2). The server snapshot in
 * the create response is the truth; null when a price is missing or currencies differ.
 */
export function estimateTotal(ctx: RegistrationContext, draft: Draft): PriceEstimate {
  let total = 0;
  let currency: string | null = null;
  for (const candidate of orderedSelection(ctx, draft)) {
    const modality = modalityOf(ctx, ensureParticipant(draft, candidate.candidate_key).modalityId);
    if (!modality?.price) return null;
    if (currency && currency !== modality.price.currency) return null;
    currency = modality.price.currency;
    total += modality.price.amount_minor;
  }
  return currency ? { amountMinor: total, currency } : null;
}

// ---- Server verdicts kept next to the draft until the person changes the thing they refer to ----

export type ServerErrors = {
  rows: Record<string, string[]>;
  fields: Record<string, Record<string, string>>;
  categories: Record<string, string>;
};
export const NO_SERVER_ERRORS: ServerErrors = { rows: {}, fields: {}, categories: {} };

/** Local (UX) validation plus the server's verdicts; blank messages mean "cleared" and never count as errors. */
export function mergeDetailsErrors(local: DetailsErrors, server: ServerErrors): DetailsErrors {
  const merged: DetailsErrors = {};
  for (const [key, entry] of Object.entries(local)) merged[key] = { ...entry, fields: { ...entry.fields } };
  for (const [key, fields] of Object.entries(server.fields)) {
    for (const [fieldKey, message] of Object.entries(fields)) {
      if (!message) continue;
      merged[key] ??= { fields: {} };
      merged[key].fields[fieldKey] ??= message;
    }
  }
  for (const [key, message] of Object.entries(server.categories)) {
    if (!message) continue;
    merged[key] ??= { fields: {} };
    merged[key].category ??= message;
  }
  return merged;
}

/** Why the final submit must stay disabled right now (derived from the current context, never remembered). */
export function submitBlockedReason(ctx: RegistrationContext, draft: Draft): string | null {
  if (participantsStepError(ctx, draft)) return "Elige al menos un participante.";
  if (Object.keys(validateDetails(ctx, draft)).length > 0) return "Faltan datos de modalidad o del formulario. Vuelve al paso “Modalidad y datos”.";
  const legal = legalStatus(ctx, draft);
  if (legal.accountPending) return "Acepta los documentos de tu cuenta en el paso “Legal”.";
  if (legal.buyerBoxesPending > 0) return "Faltan documentos del evento por aceptar en el paso “Legal”.";
  if (legal.blockedByOthers) {
    const names = legal.pendingOthers.map((candidate) => candidate.display_name ?? "una persona").join(", ");
    return `Esta inscripción gratuita se confirma al instante: ${names} debe aceptar los documentos desde su cuenta antes de que puedas enviar.`;
  }
  return null;
}
