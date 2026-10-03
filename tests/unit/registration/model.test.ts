import { describe, expect, test } from "vitest";
import {
  buildCreateBody,
  candidateState,
  categoryChoices,
  estimateTotal,
  fieldsFor,
  initialDraft,
  legalStatus,
  mergeDetailsErrors,
  modalityOption,
  noRegistrableModality,
  orderedSelection,
  reconcileDraft,
  restoreSavedDraft,
  setAccepted,
  setCategory,
  setModality,
  setResponse,
  submitBlockedReason,
  toggleCandidate,
  validateDetails,
  validateField,
  NO_SERVER_ERRORS,
} from "@/components/registration/logic/model";
import { baseContext, candidate, ID, MINOR_DOC, peopleContext, verdict, WAIVER_DOC } from "./fixtures";

const FRIEND = `profile:${ID.friendProfile}`;
const GUEST = `guest:${ID.guest}`;
const MINOR = `profile:${ID.minorProfile}`;

describe("P2-AC-06.b builder offers exactly the eligible participants, with reasons for the rest", () => {
  test("self is preselected; friend and guest are selectable; the minor without a guardian is blocked with its reason", () => {
    const ctx = peopleContext();
    const draft = initialDraft(ctx);
    expect(draft.selected).toEqual(["self"]);
    expect(candidateState(ctx, ctx.candidates[1]).selectable).toBe(true);
    const minor = ctx.candidates.find((c) => c.candidate_key === MINOR)!;
    const state = candidateState(ctx, minor);
    expect(state.selectable).toBe(false);
    expect(state.reason).toMatch(/adulto responsable/);
  });

  test("an ineligible candidate can never be added, even by a direct call", () => {
    const ctx = peopleContext();
    const next = toggleCandidate(ctx, initialDraft(ctx), MINOR, true);
    expect(next.selected).toEqual(["self"]);
  });

  test("a participant already registered or held is blocked with the T12 copy (second person for the buyer)", () => {
    const ctx = baseContext("FREE", {
      candidates: [
        candidate({
          candidate_key: "self",
          relation: "SELF",
          modalities: [verdict(ID.m5k, { eligible: false, code: "DUPLICATE_REGISTRATION" }), verdict(ID.m10k, { eligible: false, code: "DUPLICATE_REGISTRATION" })],
        }),
        candidate({
          candidate_key: GUEST,
          relation: "GUEST",
          display_name: "Caro",
          modalities: [verdict(ID.m5k, { eligible: false, code: "PARTICIPANT_ALREADY_HELD" }), verdict(ID.m10k, { eligible: false, code: "PARTICIPANT_ALREADY_HELD" })],
        }),
      ],
    });
    expect(candidateState(ctx, ctx.candidates[0]).reason).toBe("Ya tienes un lugar en este evento.");
    expect(candidateState(ctx, ctx.candidates[1]).reason).toBe("Ya tiene un lugar apartado en este evento.");
    expect(initialDraft(ctx).selected).toEqual([]);
  });

  test("per-modality: capacity comes from the modality, rules from the verdict, both with a reason", () => {
    const ctx = peopleContext();
    const guest = ctx.candidates.find((c) => c.candidate_key === GUEST)!;
    const modality10k = ctx.modalities.find((m) => m.modality_id === ID.m10k)!;
    expect(modalityOption(guest, modality10k)).toEqual({ selectable: false, reason: "No cumple los requisitos de esta modalidad." });
    const held = { ...modality10k, registrable: false, availability_state: "TEMPORARILY_UNAVAILABLE" as const, unavailable_reason: "TEMPORARILY_UNAVAILABLE" as const };
    expect(modalityOption(ctx.candidates[0], held).reason).toBe("Temporalmente no disponible");
    const soldOut = { ...modality10k, registrable: false, availability_state: "SOLD_OUT" as const, unavailable_reason: "SOLD_OUT" as const };
    expect(modalityOption(ctx.candidates[0], soldOut).reason).toBe("Agotado");
  });

  test("the request is capped at max_participants_per_request", () => {
    const many = Array.from({ length: 3 }, (_, index) => candidate({ candidate_key: `guest:${index}`, relation: "GUEST", guest_participant_id: ID.guest, display_name: `G${index}` }));
    const ctx = baseContext("FREE", { candidates: many, registration: { ...baseContext().registration, max_participants_per_request: 2 } });
    let draft = initialDraft(ctx);
    for (const item of many) draft = toggleCandidate(ctx, draft, item.candidate_key, true);
    expect(draft.selected).toHaveLength(2);
  });

  test("noRegistrableModality only when every modality is closed/held/sold out", () => {
    const ctx = baseContext();
    expect(noRegistrableModality(ctx)).toBe(false);
    expect(noRegistrableModality({ ...ctx, modalities: ctx.modalities.map((m) => ({ ...m, registrable: false })) })).toBe(true);
  });
});

describe("P2-AC-05.b the draft only ever holds choices; the server context stays the authority", () => {
  test("reconcile drops a participant, modality or category the fresh context no longer offers", () => {
    const ctx = peopleContext();
    let draft = initialDraft(ctx);
    draft = toggleCandidate(ctx, draft, GUEST, true);
    draft = setModality(ctx, draft, "self", ID.m10k);
    draft = setCategory(draft, "self", ID.catLibre);
    // fresh context: 10K now closed for everyone, guest became ineligible everywhere
    const closed = { ...ctx, modalities: ctx.modalities.map((m) => (m.modality_id === ID.m10k ? { ...m, registrable: false, unavailable_reason: "SOLD_OUT" as const, availability_state: "SOLD_OUT" as const } : m)) };
    const guestOut = {
      ...closed,
      candidates: closed.candidates.map((c) =>
        c.candidate_key === GUEST ? { ...c, modalities: c.modalities.map((v) => ({ ...v, eligible: false, code: "DUPLICATE_REGISTRATION", reasons: [] })) } : c,
      ),
    };
    const next = reconcileDraft(guestOut, draft);
    expect(next.selected).toEqual(["self"]);
    expect(next.participants.self.modalityId).toBe(ID.m5k); // the only open modality is preselected again, never the stale 10K
    expect(next.participants.self.categoryId).toBeNull();
  });

  test("reconcile keeps typed answers that still have a field and drops the ones whose field disappeared", () => {
    const ctx = baseContext();
    let draft = initialDraft(ctx);
    draft = setModality(ctx, draft, "self", ID.m10k);
    draft = setResponse(draft, "self", "shirt_size", "M");
    draft = setResponse(draft, "self", "pace", "5");
    const without = { ...ctx, forms: ctx.forms.filter((f) => f.modality_id === null) };
    const next = reconcileDraft(without, draft);
    expect(next.participants.self.responses).toEqual({ shirt_size: "M" });
  });

  // P2-G8 / F2: the saved draft arrives after an async account lookup; it used to replace whatever the buyer did meanwhile.
  test("restoring a saved draft fills an untouched screen but never overrides what the buyer already chose", () => {
    const ctx = baseContext();
    // Saved by an earlier visit when only 10K was open (auto-selected); now both modalities are open.
    const saved = setCategory(setModality(ctx, initialDraft(ctx), "self", ID.m10k), "self", ID.catLibre);
    const untouched = initialDraft(ctx);
    expect(untouched.participants.self.modalityId).toBeNull();
    expect(restoreSavedDraft(ctx, untouched, saved).participants.self.modalityId).toBe(ID.m10k);

    const chose5k = setModality(ctx, untouched, "self", ID.m5k);
    expect(restoreSavedDraft(ctx, chose5k, saved)).toBe(chose5k);
    const typed = setResponse(untouched, "self", "shirt_size", "M");
    expect(restoreSavedDraft(ctx, typed, saved)).toBe(typed);
    const unticked = toggleCandidate(ctx, untouched, "self", false);
    expect(restoreSavedDraft(ctx, unticked, saved)).toBe(unticked);
  });

  test("a restored selection that is no longer valid is still dropped (reconcile runs on the saved draft)", () => {
    const ctx = baseContext();
    const saved = setCategory(setModality(ctx, initialDraft(ctx), "self", ID.m10k), "self", ID.catLibre);
    const closed = { ...ctx, modalities: ctx.modalities.map((m) => (m.modality_id === ID.m10k ? { ...m, registrable: false, unavailable_reason: "SOLD_OUT" as const, availability_state: "SOLD_OUT" as const } : m)) };
    const restored = restoreSavedDraft(closed, initialDraft(closed), saved);
    expect(restored.participants.self.modalityId).toBe(ID.m5k);
    expect(restored.participants.self.categoryId).toBeNull();
  });

  test("changing the modality prunes answers of the previous modality's form and resets the category", () => {
    const ctx = baseContext();
    let draft = initialDraft(ctx);
    draft = setModality(ctx, draft, "self", ID.m10k);
    draft = setCategory(draft, "self", ID.catLibre);
    draft = setResponse(draft, "self", "pace", "5");
    draft = setModality(ctx, draft, "self", ID.m5k);
    expect(draft.participants.self.categoryId).toBeNull();
    expect(draft.participants.self.responses).toEqual({});
  });

  test("estimateTotal is a display sum of the server's modality prices and null when a price is missing", () => {
    const ctx = baseContext("EXTERNAL_WHATSAPP", {
      candidates: [
        candidate({ candidate_key: "self", relation: "SELF" }),
        candidate({ candidate_key: GUEST, relation: "GUEST", display_name: "Caro" }),
      ],
    });
    let draft = initialDraft(ctx);
    draft = toggleCandidate(ctx, draft, GUEST, true);
    draft = setModality(ctx, draft, "self", ID.m5k);
    draft = setModality(ctx, draft, GUEST, ID.m10k);
    expect(estimateTotal(ctx, draft)).toEqual({ amountMinor: 60000, currency: "MXN" });
    expect(estimateTotal(ctx, { ...draft, participants: { ...draft.participants, [GUEST]: { ...draft.participants[GUEST], modalityId: null } } })).toBeNull();
  });
});

describe("P2-AC-07 dynamic form rendering + validation", () => {
  test("a participant answers the union of the edition-wide form and the modality form, edition-wide first, no repeats", () => {
    const ctx = baseContext();
    expect(fieldsFor(ctx, ID.m5k).map((f) => f.field_key)).toEqual(["shirt_size", "club"]);
    expect(fieldsFor(ctx, ID.m10k).map((f) => f.field_key)).toEqual(["shirt_size", "club", "pace"]);
    const dup = { ...ctx, forms: [...ctx.forms, { ...ctx.forms[1], registration_form_id: ID.form10k, fields: [{ ...ctx.forms[0].fields[0], label: "OTRA" }] }] };
    expect(fieldsFor(dup, ID.m10k).filter((f) => f.field_key === "shirt_size")).toHaveLength(1);
  });

  const field = (type: string, extra: Record<string, unknown> = {}, required = false) =>
    ({ field_key: "f", label: "F", field_type: type, required, validation_config: {}, options_config: {}, sort_order: 1, ...extra }) as never;

  test("required / empty", () => {
    expect(validateField(field("TEXT", {}, true), undefined)).toBe("Este campo es obligatorio.");
    expect(validateField(field("TEXT", {}, true), "   ")).toBe("Este campo es obligatorio.");
    expect(validateField(field("TEXT", {}, false), "")).toBeNull();
  });
  test("text length bounds use the trimmed length", () => {
    const f = field("TEXT", { validation_config: { min_length: 3, max_length: 5 } });
    expect(validateField(f, "ab")).toMatch(/al menos 3/);
    expect(validateField(f, "abcdef")).toMatch(/máximo 5/);
    expect(validateField(f, "  abc  ")).toBeNull();
  });
  test("select options come from the server definition", () => {
    const f = field("SELECT", { options_config: { options: [{ value: "S", label: "Chica" }] } }, true);
    expect(validateField(f, "S")).toBeNull();
    expect(validateField(f, "XL")).toBe("Elige una opción de la lista.");
  });
  test("multiselect counts, boolean is answered true or false, number range and integer, date range", () => {
    const multi = field("MULTISELECT", { options_config: { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }, validation_config: { min_items: 1, max_items: 1 } }, true);
    expect(validateField(multi, ["a"])).toBeNull();
    expect(validateField(multi, ["a", "b"])).toMatch(/entre 1 y 1/);
    expect(validateField(multi, ["z"])).toBe("Elige una opción de la lista.");
    expect(validateField(field("BOOLEAN", {}, true), false)).toBeNull();
    expect(validateField(field("BOOLEAN", {}, true), undefined)).toBe("Este campo es obligatorio.");
    const num = field("NUMBER", { validation_config: { min: 3, max: 12, integer: true } });
    expect(validateField(num, "5")).toBeNull();
    expect(validateField(num, "5.5")).toBe("Escribe un número entero.");
    expect(validateField(num, "20")).toMatch(/entre 3 y 12/);
    expect(validateField(num, "abc")).toBe("El valor no es válido.");
    const date = field("DATE", { validation_config: { min_date: "2026-01-01", max_date: "2026-12-31" } });
    expect(validateField(date, "2026-06-01")).toBeNull();
    expect(validateField(date, "2027-01-01")).toMatch(/fecha/);
    expect(validateField(date, "12/0")).toBe("Escribe una fecha válida (dd/mm/aaaa).");
  });

  test("validateDetails reports modality, category and field errors per participant and clears when satisfied", () => {
    const ctx = baseContext();
    let draft = initialDraft(ctx);
    expect(validateDetails(ctx, draft).self.modality).toBe("Elige una modalidad.");
    draft = setModality(ctx, draft, "self", ID.m10k);
    // single allowed category is preselected, shirt_size is required
    expect(draft.participants.self.categoryId).toBe(ID.catLibre);
    expect(Object.keys(validateDetails(ctx, draft).self.fields)).toEqual(["shirt_size"]);
    draft = setResponse(draft, "self", "shirt_size", "M");
    expect(validateDetails(ctx, draft)).toEqual({});
  });

  test("category choices are exactly the categories the server allows for that person", () => {
    const ctx = baseContext("FREE", {
      candidates: [
        candidate({ candidate_key: "self", relation: "SELF", modalities: [verdict(ID.m5k), verdict(ID.m10k, { category_selection_required: true, allowed_category_ids: [ID.catLibre, ID.catMaster] })] }),
      ],
    });
    expect(categoryChoices(ctx, ctx.candidates[0], ID.m10k).map((c) => c.name)).toEqual(["Libre", "Máster 40+"]);
    const draft = setModality(ctx, initialDraft(ctx), "self", ID.m10k);
    expect(draft.participants.self.categoryId).toBeNull(); // two choices: the person decides
    expect(validateDetails(ctx, draft).self.category).toBe("Elige una categoría.");
  });

  test("mergeDetailsErrors ignores cleared server verdicts and layers the server's on the local ones", () => {
    const merged = mergeDetailsErrors({}, { rows: {}, fields: { self: { shirt_size: "Este campo es obligatorio.", club: "" } }, categories: { self: "" } });
    expect(merged).toEqual({ self: { fields: { shirt_size: "Este campo es obligatorio." } } });
    expect(mergeDetailsErrors({}, NO_SERVER_ERRORS)).toEqual({});
  });
});

describe("P2-AC-03.b event documents per participant and the account gate", () => {
  test("buyer-acceptable documents need a tick; an adult Friend's do not (status only); FREE blocks on the Friend, WhatsApp does not", () => {
    const free = peopleContext("FREE");
    let draft = toggleCandidate(free, initialDraft(free), FRIEND, true);
    let status = legalStatus(free, draft);
    expect(status.buyerBoxesPending).toBe(1);
    expect(status.pendingOthers.map((c) => c.display_name)).toEqual(["Beto Amigo"]);
    expect(status.blockedByOthers).toBe(true);
    expect(status.complete).toBe(false);
    draft = setAccepted(draft, "self", ID.waiver, true);
    status = legalStatus(free, draft);
    expect(status.buyerBoxesPending).toBe(0);
    expect(status.complete).toBe(false); // FREE confirms at once: the Friend must have accepted first
    expect(submitBlockedReason(free, setModalities(free, draft))).toMatch(/Beto Amigo debe aceptar/);

    const wa = peopleContext("EXTERNAL_WHATSAPP");
    let waDraft = toggleCandidate(wa, initialDraft(wa), FRIEND, true);
    waDraft = setAccepted(waDraft, "self", ID.waiver, true);
    const waStatus = legalStatus(wa, waDraft);
    expect(waStatus.pendingOthers).toHaveLength(1);
    expect(waStatus.blockedByOthers).toBe(false);
    expect(waStatus.complete).toBe(true);
  });

  function setModalities(ctx: ReturnType<typeof peopleContext>, draft: ReturnType<typeof initialDraft>) {
    let next = draft;
    for (const key of draft.selected) {
      next = setModality(ctx, next, key, ID.m5k);
      next = setResponse(next, key, "shirt_size", "M");
    }
    return next;
  }

  test("the account-level gate blocks completion until TERMS/PRIVACY are accepted", () => {
    const ctx = baseContext("FREE", {
      account_legal: {
        needs_acceptance: true,
        needs_reacceptance: false,
        missing_document_version_ids: [ID.terms, ID.privacy],
        documents: [
          { document_type: "TERMS_OF_SERVICE", document_key: "TERMS_OF_SERVICE", legal_document_version_id: ID.terms, version: 2, published_at: null, status: "NEVER_ACCEPTED", accepted_at: null, accepted_version: null },
          { document_type: "PRIVACY_NOTICE", document_key: "PRIVACY_NOTICE", legal_document_version_id: ID.privacy, version: 1, published_at: null, status: "NEVER_ACCEPTED", accepted_at: null, accepted_version: null },
        ],
      },
    });
    const draft = initialDraft(ctx);
    expect(legalStatus(ctx, draft).accountPending).toBe(true);
    expect(legalStatus(ctx, draft).complete).toBe(false);
  });

  test("a minor under the buyer's guardianship needs the buyer's tick for both documents; another guardian's minor is status only", () => {
    const ward = candidate({
      candidate_key: MINOR,
      relation: "WARD",
      public_profile_id: ID.minorProfile,
      display_name: "Dani",
      is_minor: true,
      acceptance: { required_document_version_ids: [ID.waiver, ID.minorTerms], missing_document_version_ids: [ID.waiver, ID.minorTerms], buyer_can_accept: true, acceptor: "GUARDIAN" },
    });
    const other = candidate({
      candidate_key: `profile:other`,
      relation: "FRIEND",
      public_profile_id: ID.friendProfile,
      display_name: "Eli",
      is_minor: true,
      acceptance: { required_document_version_ids: [ID.waiver, ID.minorTerms], missing_document_version_ids: [ID.minorTerms], buyer_can_accept: false, acceptor: "OTHER_GUARDIAN" },
    });
    const ctx = baseContext("EXTERNAL_WHATSAPP", { documents: [WAIVER_DOC, MINOR_DOC], candidates: [ward, other] });
    let draft = toggleCandidate(ctx, toggleCandidate(ctx, { selected: [], participants: {} }, MINOR, true), "profile:other", true);
    const status = legalStatus(ctx, draft);
    expect(status.buyerBoxesPending).toBe(2);
    expect(status.rows[1].pendingOther).toBe(true);
    draft = setAccepted(setAccepted(draft, MINOR, ID.waiver, true), MINOR, ID.minorTerms, true);
    expect(legalStatus(ctx, draft).buyerBoxesPending).toBe(0);
  });
});

describe("buildCreateBody (what is sent is only choices; the server derives the rest)", () => {
  test("PROFILE/GUEST ids, category only when the buyer must pick, answers typed, acceptance indices aligned", () => {
    const ctx = peopleContext("EXTERNAL_WHATSAPP");
    let draft = initialDraft(ctx);
    draft = toggleCandidate(ctx, draft, GUEST, true);
    draft = setModality(ctx, draft, "self", ID.m10k);
    draft = setResponse(draft, "self", "shirt_size", "M");
    draft = setResponse(draft, "self", "pace", "5,5");
    draft = setResponse(draft, "self", "club", "  Club X ");
    draft = setModality(ctx, draft, GUEST, ID.m5k);
    draft = setResponse(draft, GUEST, "shirt_size", "S");
    draft = setAccepted(draft, "self", ID.waiver, true);
    draft = setAccepted(draft, GUEST, ID.waiver, true);
    const body = buildCreateBody(ctx, draft);
    expect(body.edition_id).toBe(ID.edition);
    expect(body.participants).toEqual([
      { kind: "PROFILE", public_profile_id: ID.selfProfile, modality_id: ID.m10k, category_id: ID.catLibre, responses: { shirt_size: "M", club: "Club X", pace: 5.5 } },
      { kind: "GUEST", guest_participant_id: ID.guest, modality_id: ID.m5k, responses: { shirt_size: "S" } },
    ]);
    expect(body.legal_acceptances).toEqual([
      { participant_index: 0, legal_document_version_id: ID.waiver },
      { participant_index: 1, legal_document_version_id: ID.waiver },
    ]);
  });

  test("never sends an acceptance the buyer may not give (adult Friend) nor one that is not missing", () => {
    const ctx = peopleContext("EXTERNAL_WHATSAPP");
    let draft = toggleCandidate(ctx, initialDraft(ctx), FRIEND, true);
    draft = setAccepted(draft, FRIEND, ID.waiver, true);
    draft = setAccepted(draft, "self", ID.minorTerms, true); // not required for self
    const body = buildCreateBody(ctx, draft);
    expect(body.legal_acceptances).toEqual([]);
  });

  test("a SYSTEM_DERIVES / NONE modality never sends category_id", () => {
    const ctx = baseContext();
    const draft = setModality(ctx, initialDraft(ctx), "self", ID.m5k);
    expect(buildCreateBody(ctx, draft).participants[0]).not.toHaveProperty("category_id");
  });

  test("orderedSelection follows the context order, not click order", () => {
    const ctx = peopleContext();
    let draft = toggleCandidate(ctx, { selected: [], participants: {} }, GUEST, true);
    draft = toggleCandidate(ctx, draft, "self", true);
    expect(orderedSelection(ctx, draft).map((c) => c.candidate_key)).toEqual(["self", GUEST]);
  });
});
