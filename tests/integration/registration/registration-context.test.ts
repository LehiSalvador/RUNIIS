import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AppError } from "@/lib/server/http/errors";
import {
  createCategory,
  createContentBlock,
  createEdition,
  createEvent,
  createLegalDocument,
  createLegalDocumentVersion,
  createModality,
  createPriceOffer,
  createRegistrationForm,
  publishLegalDocumentVersion,
  publishRegistrationForm,
  setModalityCapacity,
  setModalityStatus,
  transitionEdition,
  updateEdition,
} from "@/lib/server/domain/events/service";
import { createGuardianAssignment, createGuest, requestFriendship, respondFriendship } from "@/lib/server/domain/people/service";
import {
  acceptEditionDocuments,
  cancelRegistrationRequest,
  confirmRegistrationRequest,
  createRegistrationRequest,
  getRegistrationContext,
} from "@/lib/server/domain/registration/service";
import { registrationContextSchema, type RegistrationCandidate, type RegistrationContext } from "@/lib/shared/registration-context";
import { cleanup, createTestStaff, createTestUser, queryValue, sql, type TestStaff, type TestUser } from "../helpers";
import { ensureGlobalLegalDocumentsPublished } from "./helpers";

// P2-B registration context read model (P2-AC-05.a) and the server-side participant rules the builder relies
// on (P2-AC-06.a, P2-AC-03.a, P2-AC-08.a, P2-AC-09.a). Real local Postgres + RLS through the domain layer.

async function appError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected the promise to reject with an AppError");
}

function isoDatePlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
/** Date of birth that makes someone exactly `years` (+ a margin) old on the Edition's event date (60 days out). */
function dobForAge(years: number, marginDays = 120): string {
  return new Date(Date.now() + 60 * 86_400_000 - years * 365.25 * 86_400_000 - marginDays * 86_400_000).toISOString().slice(0, 10);
}
function guestFields(name: string, dob: string, phone: string) {
  return {
    full_name: name,
    date_of_birth: dob,
    sex_code: "F" as const,
    phone_e164: phone,
    emergency_contact_name: "Contacto",
    emergency_contact_phone_e164: "+528110004999",
    emergency_contact_relationship: "Madre",
  };
}
/** Guest creation itself refuses under 15, so a stale/legacy row is inserted directly to prove the inclusion rule. */
function insertUnder15Guest(ownerRunnerProfileId: string, phone: string): string {
  const id = randomUUID();
  sql(`insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
         emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
       values ('${id}', '${ownerRunnerProfileId}', 'Menor De Quince', '${dobForAge(14)}', 'F', '${phone}', 'Contacto', '+528110004999', 'Madre')`);
  return id;
}
const RESPONSES = { shirt_size: "M" };
function candidate(context: RegistrationContext, key: string): RegistrationCandidate {
  const found = context.candidates.find((c) => c.candidate_key === key);
  if (!found) throw new Error(`candidate ${key} not in context: ${context.candidates.map((c) => c.candidate_key).join(", ")}`);
  return found;
}
function verdict(c: RegistrationCandidate, modalityId: string) {
  const found = c.modalities.find((m) => m.modality_id === modalityId);
  if (!found) throw new Error(`no verdict for modality ${modalityId}`);
  return found;
}

type Rich = {
  editionId: string;
  slug: string;
  m5k: string; // capacity 1: last slot
  m10k: string; // capacity 10, USER_SELECTS categories
  m21k: string; // capacity 5, adults only, SYSTEM_DERIVES category
  m3k: string; // CLOSED
  catLibre: string;
  catJuvenil: string;
  catAbierta: string;
  waiverId: string;
  rulesId: string;
  minorTermsId: string;
};

describe("registration context (P2-B) integration", () => {
  let admin: TestStaff;
  const authUserIds: string[] = [];

  beforeAll(async () => {
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
  }, 30_000);

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  async function user(label: string, dob = "1990-01-01"): Promise<TestUser> {
    const u = await createTestUser({ label: `ctx-${label}`, dob });
    authUserIds.push(u.authUserId);
    return u;
  }

  /** Real admin commands end to end: Event -> Edition -> Modalities -> capacity/price -> categories -> forms ->
   * EVENT_RULES document -> publish -> open registration. */
  async function buildRich(mode: "FREE" | "EXTERNAL_WHATSAPP"): Promise<Rich> {
    // One Edition takes ~30 admin commands; admin.mutation allows 120/min per staff (Master §179).
    sql(`delete from infra.rate_limit_counter where scope in ('admin.mutation', 'admin.mutation:cmd')`);
    const a: SupabaseClient = admin.client;
    const tag = randomUUID().slice(0, 8);
    const event = await createEvent(a, { event_type_key: "ROAD_RACE", name: "Contexto Integración", canonical_key: `ctx-${tag}` }, null);
    const edition = await createEdition(
      a,
      event.event_id,
      {
        slug: `ctx-${tag}`,
        name: "Contexto Integración Edición",
        registration_mode: mode,
        city: "Monterrey",
        state_region: "NL",
        ...(mode === "EXTERNAL_WHATSAPP" ? { whatsapp_phone_e164: "+528110009222" } : {}),
        schedule: { local_date: isoDatePlus(60), local_start_time: "07:00:00" },
      },
      null,
    );
    const price = mode === "FREE" ? 0 : 25000;
    const mk = async (key: string, name: string, capacity: number, rules: Record<string, unknown>, sort: number) => {
      const m = await createModality(a, edition.edition_id, { key, name, official_distance_m: 5000, eligibility_rules: rules, sort_order: sort }, null);
      await setModalityCapacity(a, m.modality_id, { effective_capacity: capacity });
      await createPriceOffer(a, m.modality_id, { name: "General", amount_minor: price }, null);
      return m.modality_id;
    };
    const m5k = await mk("5k", "5K", 1, {}, 1);
    const m10k = await mk("10k", "10K", 10, {}, 2);
    const m21k = await mk("21k", "21K", 5, { min_age: 18 }, 3);
    const m3k = await mk("3k", "3K", 5, {}, 4);

    const catLibre = (await createCategory(a, edition.edition_id, { key: "libre", name: "Libre 18+", assignment_mode: "USER_SELECTS", eligibility_rule: { min_age: 18 }, modality_ids: [m10k] })).category_id;
    const catJuvenil = (await createCategory(a, edition.edition_id, { key: "juvenil", name: "Juvenil", assignment_mode: "USER_SELECTS", eligibility_rule: { min_age: 15, max_age: 17 }, modality_ids: [m10k] })).category_id;
    const catAbierta = (await createCategory(a, edition.edition_id, { key: "abierta", name: "Abierta", assignment_mode: "SYSTEM_DERIVES", modality_ids: [m21k] })).category_id;

    // Edition-wide form + a 10K-only form.
    const wide = await createRegistrationForm(a, edition.edition_id, {
      fields: [
        { field_key: "shirt_size", label: "Talla de playera", field_type: "SELECT", required: true, options_config: { options: [{ value: "S", label: "S" }, { value: "M", label: "M" }] }, sort_order: 1 },
        { field_key: "club", label: "Club", field_type: "TEXT", required: false, validation_config: { max_length: 80 }, sort_order: 2 },
        { field_key: "medical_notes", label: "Notas médicas", field_type: "TEXTAREA", required: false, sensitivity: "SENSITIVE", sort_order: 3 },
      ],
    });
    await publishRegistrationForm(a, wide.registration_form_id, null);
    const only10k = await createRegistrationForm(a, edition.edition_id, {
      modality_id: m10k,
      fields: [{ field_key: "pace", label: "Ritmo (min/km)", field_type: "NUMBER", required: false, validation_config: { min: 3, max: 12 }, sort_order: 1 }],
    });
    await publishRegistrationForm(a, only10k.registration_form_id, null);

    // Event-level document: EVENT_RULES bound to this Edition, with a published version.
    const rules = await createLegalDocument(a, { document_type: "EVENT_RULES", edition_id: edition.edition_id });
    const rulesVersion = await createLegalDocumentVersion(a, rules.legal_document_id, { content_markdown: "[TEST] reglamento" });
    await publishLegalDocumentVersion(a, rulesVersion.legal_document_version_id, null);

    await createContentBlock(a, edition.edition_id, {
      block_type: "RICH_TEXT",
      status: "PUBLISHED",
      payload: { markdown: "Contenido de prueba del contexto de inscripción con más de treinta caracteres." },
    });
    await transitionEdition(a, "publish", edition.edition_id, {}, null);
    await transitionEdition(a, "open-registration", edition.edition_id, {}, null);
    // CLOSED after opening: it stays listed (and visible to the buyer) but is not registrable.
    await setModalityStatus(a, m3k, { status: "CLOSED" });

    const docId = (key: string) => queryValue(`select (private.current_legal_version(legal_document_id) ->> 'legal_document_version_id') from app.legal_document where document_key = '${key}'`)!;
    return {
      editionId: edition.edition_id,
      slug: edition.slug,
      m5k,
      m10k,
      m21k,
      m3k,
      catLibre,
      catJuvenil,
      catAbierta,
      waiverId: docId("SPORT_WAIVER"),
      rulesId: rulesVersion.legal_document_version_id,
      minorTermsId: docId("MINOR_TERMS"),
    };
  }

  async function context(buyer: TestUser, slug: string): Promise<RegistrationContext> {
    const result = await getRegistrationContext(buyer.client, slug);
    if (!result || result.redirect) throw new Error(`no context for ${slug}`);
    return result.context;
  }

  test("P2-AC-05.a: edition, window, hold, availability, price, categories, forms, documents are server-derived", async () => {
    const rich = await buildRich("EXTERNAL_WHATSAPP");
    const buyer = await user("shape");
    const ctx = await context(buyer, rich.slug);

    // The service already parses with the strict schema; assert it explicitly too (contract is shared).
    expect(registrationContextSchema.safeParse({ ...ctx, existing: { ...ctx.existing, pending_request: null } }).success).toBe(true);

    expect(ctx.edition).toMatchObject({ slug: rich.slug, registration_mode: "EXTERNAL_WHATSAPP", registration_state: "OPEN", execution_state: "SCHEDULED" });
    expect(ctx.registration.can_register).toBe(true);
    expect(ctx.registration.blocking_code).toBeNull();
    expect(ctx.registration.max_participants_per_request).toBe(20);
    expect(Date.parse(ctx.server_time)).toBeGreaterThan(Date.now() - 60_000);

    // Absolute 24 h hold projected from the server clock, capped by the registration close (Master §63).
    expect(ctx.hold).toMatchObject({ kind: "ABSOLUTE", duration_minutes: 1440, extends_on_activity: false });
    const projected = Date.parse(ctx.hold!.projected_expires_at);
    expect(projected).toBeLessThanOrEqual(Date.parse(ctx.server_time) + 24 * 3_600_000 + 5_000);
    expect(projected).toBeLessThanOrEqual(Date.parse(ctx.registration.closes_at));
    expect(ctx.whatsapp).toEqual({ configured: true });

    expect(ctx.modalities.map((m) => m.key)).toEqual(["5k", "10k", "21k", "3k"]);
    const m5k = ctx.modalities.find((m) => m.modality_id === rich.m5k)!;
    expect(m5k).toMatchObject({ availability_state: "AVAILABLE", registrable: true, unavailable_reason: null, category_mode: "NONE" });
    expect(m5k.price).toMatchObject({ amount_minor: 25000, currency: "MXN", source: "PRICE_OFFER" });
    expect(ctx.modalities.find((m) => m.modality_id === rich.m10k)!.category_mode).toBe("USER_SELECTS");
    expect(ctx.modalities.find((m) => m.modality_id === rich.m21k)!.category_mode).toBe("SYSTEM_DERIVES");
    expect(ctx.modalities.find((m) => m.modality_id === rich.m3k)).toMatchObject({ status: "CLOSED", registrable: false, unavailable_reason: "MODALITY_CLOSED" });

    expect(ctx.categories.map((c) => c.key).sort()).toEqual(["abierta", "juvenil", "libre"]);

    expect(ctx.forms).toHaveLength(2);
    const wide = ctx.forms.find((f) => f.modality_id === null)!;
    expect(wide.fields.map((f) => f.field_key)).toEqual(["shirt_size", "club", "medical_notes"]);
    expect(wide.fields[0]).toMatchObject({ required: true, field_type: "SELECT" });
    expect(Object.keys(wide.fields[0]!)).not.toContain("sensitivity"); // staff classification never reaches the buyer
    expect(ctx.forms.find((f) => f.modality_id === rich.m10k)!.fields[0]).toMatchObject({ field_key: "pace", field_type: "NUMBER" });

    const byType = Object.fromEntries(ctx.documents.map((d) => [d.document_type, d]));
    expect(byType.SPORT_WAIVER).toMatchObject({ legal_document_version_id: rich.waiverId, applies_to: "ALL" });
    expect(byType.MINOR_TERMS).toMatchObject({ legal_document_version_id: rich.minorTermsId, applies_to: "MINOR" });
    expect(byType.EVENT_RULES).toMatchObject({ legal_document_version_id: rich.rulesId, applies_to: "ALL" });
    expect(byType.EVENT_RULES!.document_key).toMatch(/^EVENT_RULES_[0-9A-F]{32}$/);

    expect(ctx.account_legal.needs_acceptance).toBe(false);
    expect(ctx.existing).toEqual({ pending_request: null, registrations: [] });
  }, 90_000);

  test("P2-AC-06.a / P2-AC-05.a: candidates and per-modality verdicts (self, Friend, Guest, minor, guardian) carry stable codes and no PII", async () => {
    const rich = await buildRich("FREE");
    const buyer = await user("cand");
    const friend = await user("cand-friend");
    const stranger = await user("cand-stranger");
    const pendingFriend = await user("cand-pending-friend");

    const friendship = await requestFriendship(buyer.client, friend.publicProfileId!, null);
    await respondFriendship(friend.client, friendship.friendship_id, "accept");
    await requestFriendship(buyer.client, pendingFriend.publicProfileId!, null); // PENDING: never a candidate

    const adultGuest = await createGuest(buyer.client, guestFields("Invitado Adulto", "1995-06-01", "+528110004601"), null);
    const minorGuest = await createGuest(buyer.client, guestFields("Invitado Menor", dobForAge(16), "+528110004602"), null);
    await createGuardianAssignment(buyer.client, { minor_kind: "GUEST", guest_participant_id: minorGuest.guest_participant_id, relationship_type: "PARENT" });
    const noGuardianGuest = await createGuest(buyer.client, guestFields("Menor Sin Tutor", dobForAge(16), "+528110004603"), null);
    const under15GuestId = insertUnder15Guest(buyer.runnerProfileId!, "+528110004604");
    const strangerGuest = await createGuest(stranger.client, guestFields("Invitado Ajeno", "1994-01-01", "+528110004605"), null);

    const ctx = await context(buyer, rich.slug);
    const keys = ctx.candidates.map((c) => c.candidate_key);
    expect(keys[0]).toBe("self");
    expect(keys).toContain(`profile:${friend.publicProfileId}`);
    expect(keys).not.toContain(`profile:${pendingFriend.publicProfileId}`); // non-accepted Friend is not offered
    expect(keys).not.toContain(`profile:${stranger.publicProfileId}`);
    expect(keys).not.toContain(`guest:${strangerGuest.guest_participant_id}`); // foreign Guest is not offered

    const self = candidate(ctx, "self");
    expect(self).toMatchObject({ relation: "SELF", participant_kind: "PROFILE", is_minor: false });
    expect(self.acceptance).toMatchObject({ acceptor: "SELF", buyer_can_accept: true });
    expect(self.acceptance.required_document_version_ids.sort()).toEqual([rich.waiverId, rich.rulesId].sort());
    expect(verdict(self, rich.m5k)).toMatchObject({ eligible: true, code: null, category_selection_required: false });
    expect(verdict(self, rich.m10k)).toMatchObject({ eligible: true, category_selection_required: true, allowed_category_ids: [rich.catLibre] });
    expect(verdict(self, rich.m21k)).toMatchObject({ eligible: true, derived_category_id: rich.catAbierta });
    expect(verdict(self, rich.m3k)).toMatchObject({ eligible: false, code: "MODALITY_NOT_AVAILABLE", reasons: ["MODALITY_CLOSED"] });

    const friendCandidate = candidate(ctx, `profile:${friend.publicProfileId}`);
    expect(friendCandidate.relation).toBe("FRIEND");
    expect(friendCandidate.acceptance).toMatchObject({ acceptor: "PARTICIPANT", buyer_can_accept: false });
    expect(friendCandidate.acceptance.missing_document_version_ids.length).toBe(2); // the Friend accepts personally

    const adult = candidate(ctx, `guest:${adultGuest.guest_participant_id}`);
    expect(adult).toMatchObject({ relation: "GUEST", participant_kind: "GUEST", public_profile_id: null, is_minor: false });
    expect(adult.acceptance).toMatchObject({ acceptor: "OWNER", buyer_can_accept: true });

    const minor = candidate(ctx, `guest:${minorGuest.guest_participant_id}`);
    expect(minor.is_minor).toBe(true);
    expect(minor.acceptance).toMatchObject({ acceptor: "GUARDIAN", buyer_can_accept: true });
    expect(minor.acceptance.required_document_version_ids.sort()).toEqual([rich.minorTermsId, rich.rulesId, rich.waiverId].sort());
    expect(verdict(minor, rich.m10k)).toMatchObject({ eligible: true, category_selection_required: true, allowed_category_ids: [rich.catJuvenil] });
    expect(verdict(minor, rich.m21k)).toMatchObject({ eligible: false, code: "PARTICIPANT_NOT_ELIGIBLE", reasons: ["MODALITY_RULE"] });

    const noGuardian = candidate(ctx, `guest:${noGuardianGuest.guest_participant_id}`);
    expect(noGuardian.inclusion).toEqual({ eligible: false, reasons: ["GUARDIAN_REQUIRED"] });
    expect(verdict(noGuardian, rich.m5k)).toMatchObject({ eligible: false, code: "GUARDIAN_REQUIRED" });

    const under15 = candidate(ctx, `guest:${under15GuestId}`);
    expect(under15.inclusion.reasons).toContain("UNDER_MIN_AGE");
    expect(verdict(under15, rich.m5k)).toMatchObject({ eligible: false, code: "PARTICIPANT_NOT_ELIGIBLE" });
    expect(verdict(under15, rich.m5k).reasons).toContain("UNDER_MIN_AGE");

    // No PII of anyone: no DOB/age, phones, emergency contacts, internal ids of other people.
    const text = JSON.stringify(ctx);
    for (const forbidden of ["date_of_birth", "phone_e164", "emergency", "+5281100046", friend.runnerProfileId!, stranger.runnerProfileId!, "1995-06-01"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(ctx.candidates_truncated).toEqual({ friends: false, guests: false });
  }, 120_000);

  test("P2-AC-06.a: the server rejects each invalid participant combination at creation with a stable code", async () => {
    const rich = await buildRich("FREE");
    const buyer = await user("combo");
    const stranger = await user("combo-stranger");
    const pending = await user("combo-pending");
    await requestFriendship(buyer.client, pending.publicProfileId!, null);

    const noGuardian = await createGuest(buyer.client, guestFields("Menor Sin Tutor", dobForAge(16), "+528110004611"), null);
    const under15GuestId = insertUnder15Guest(buyer.runnerProfileId!, "+528110004612");
    // Guest creation itself already refuses under 15 (stable VALIDATION_ERROR).
    expect((await appError(createGuest(buyer.client, guestFields("Menor De Quince", dobForAge(14), "+528110004615"), null))).code).toBe("VALIDATION_ERROR");
    const foreign = await createGuest(stranger.client, guestFields("Invitado Ajeno", "1994-01-01", "+528110004613"), null);
    const ok = await createGuest(buyer.client, guestFields("Invitado Adulto", "1995-06-01", "+528110004614"), null);

    // registration_request.create allows 5 / 10 min per user (Master §179) and counts refused attempts too.
    const create = (participants: Parameters<typeof createRegistrationRequest>[1]["participants"]) => {
      sql(`delete from infra.rate_limit_counter where scope like 'registration_request.create%'`);
      return createRegistrationRequest(buyer.client, { edition_id: rich.editionId, participants, legal_acceptances: [] }, null);
    };
    const issues = (error: AppError) => (error.details.issues as { code: string; reasons?: string[] }[]).map((i) => `${i.code}:${(i.reasons ?? []).join("|")}`);

    // No ACTIVE guardian for a 15-17 participant.
    const g = await appError(create([{ kind: "GUEST", guest_participant_id: noGuardian.guest_participant_id, modality_id: rich.m5k, responses: RESPONSES }]));
    expect(g.code).toBe("GUARDIAN_REQUIRED");
    expect(g.status).toBe(422);

    // Under 15 (Master §19).
    const u = await appError(create([{ kind: "GUEST", guest_participant_id: under15GuestId, modality_id: rich.m5k, responses: RESPONSES }]));
    expect(u.code).toBe("PARTICIPANT_NOT_ELIGIBLE");
    expect(issues(u)).toContain("PARTICIPANT_NOT_ELIGIBLE:UNDER_MIN_AGE");

    // Duplicate participant inside one request.
    const d = await appError(
      create([
        { kind: "GUEST", guest_participant_id: ok.guest_participant_id, modality_id: rich.m5k, responses: RESPONSES },
        { kind: "GUEST", guest_participant_id: ok.guest_participant_id, modality_id: rich.m10k, category_id: rich.catLibre, responses: RESPONSES },
      ]),
    );
    expect(d.code).toBe("VALIDATION_ERROR");
    expect(d.details.reason).toBe("duplicate_participant");

    // Not an accepted Friend: a stranger and a PENDING friendship are both NOT_SELF_OR_FRIEND.
    for (const other of [stranger, pending]) {
      const f = await appError(create([{ kind: "PROFILE", public_profile_id: other.publicProfileId!, modality_id: rich.m5k, responses: RESPONSES }]));
      expect(f.code).toBe("PARTICIPANT_NOT_ELIGIBLE");
      expect(issues(f)).toContain("PARTICIPANT_NOT_ELIGIBLE:NOT_SELF_OR_FRIEND");
    }

    // A Guest owned by someone else is indistinguishable from a missing one (no existence oracle).
    const fg = await appError(create([{ kind: "GUEST", guest_participant_id: foreign.guest_participant_id, modality_id: rich.m5k, responses: RESPONSES }]));
    expect(fg.code).toBe("PARTICIPANT_NOT_ELIGIBLE");
    expect(issues(fg)).toContain("PARTICIPANT_NOT_ELIGIBLE:PARTICIPANT_NOT_FOUND");

    // Required category is part of the contract (USER_SELECTS): omitted -> FORM_INVALID category_id/required.
    const c = await appError(create([{ kind: "GUEST", guest_participant_id: ok.guest_participant_id, modality_id: rich.m10k, responses: RESPONSES }]));
    expect(c.code).toBe("FORM_INVALID");
    expect(JSON.stringify(c.details)).toContain("category_id");

    // Already registered (FREE confirms) then again.
    const first = await create([{ kind: "GUEST", guest_participant_id: ok.guest_participant_id, modality_id: rich.m5k, responses: RESPONSES }]).catch((e: unknown) => e);
    // FREE needs the buyer's acceptances for the Guest: required documents are part of the request.
    expect((first as AppError).code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    const accept = [rich.waiverId, rich.rulesId].map((legal_document_version_id) => ({ participant_index: 0, legal_document_version_id }));
    const created = await createRegistrationRequest(
      buyer.client,
      { edition_id: rich.editionId, participants: [{ kind: "GUEST", guest_participant_id: ok.guest_participant_id, modality_id: rich.m5k, responses: RESPONSES }], legal_acceptances: accept },
      null,
    );
    expect(created.status).toBe("CONFIRMED");
    const dup = await appError(createRegistrationRequest(buyer.client, { edition_id: rich.editionId, participants: [{ kind: "GUEST", guest_participant_id: ok.guest_participant_id, modality_id: rich.m10k, category_id: rich.catLibre, responses: RESPONSES }], legal_acceptances: accept }, null));
    expect(dup.code).toBe("DUPLICATE_REGISTRATION");
    expect(dup.status).toBe(409);
  }, 120_000);

  test("P2-AC-09.a / P2-AC-11: WhatsApp creation carries the handoff fields; hold => TEMPORARILY_UNAVAILABLE, confirmed => SOLD_OUT; pending request listed; 'already pending' is a stable conflict", async () => {
    const rich = await buildRich("EXTERNAL_WHATSAPP");
    const a = await user("race-a");
    const b = await user("race-b");
    const aGuest = await createGuest(a.client, guestFields("Invitado A", "1995-06-01", "+528110004621"), null);
    const accept = (index: number) => [rich.waiverId, rich.rulesId].map((legal_document_version_id) => ({ participant_index: index, legal_document_version_id }));

    // A takes the last slot of 5K (capacity 1): WhatsApp request = absolute hold, never "paid".
    const created = await createRegistrationRequest(
      a.client,
      { edition_id: rich.editionId, participants: [{ kind: "PROFILE", public_profile_id: a.publicProfileId!, modality_id: rich.m5k, responses: RESPONSES }], legal_acceptances: accept(0) },
      null,
    );
    expect(created.status).toBe("PENDING_CONFIRMATION");
    expect(created.registration_mode).toBe("EXTERNAL_WHATSAPP");
    expect(created.public_reference).toMatch(/^R-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(created.whatsapp_phone_e164).toBe("+528110009222");
    expect(created.whatsapp_url).toMatch(/^https:\/\/wa\.me\/528110009222\?text=/);
    const url = decodeURIComponent(new URL(created.whatsapp_url!).search);
    expect(url).toContain(created.public_reference);
    expect(url).not.toContain(a.email); // no PII in the handoff
    expect(created.total_snapshot_minor).toBe(25000);
    const holdMs = Date.parse(created.expires_at!) - Date.parse(created.created_at);
    expect(holdMs).toBeLessThanOrEqual(24 * 3_600_000 + 1_000);
    expect(holdMs).toBeGreaterThan(23 * 3_600_000);
    expect(created.participants[0]!.registration).toBeNull(); // request is not a Registration

    // A's context shows the pending request (with the link) and the participant as already held.
    const ctxA = await context(a, rich.slug);
    expect(ctxA.existing.pending_request).toMatchObject({ registration_request_id: created.registration_request_id, public_reference: created.public_reference });
    expect(ctxA.existing.pending_request!.whatsapp_url).toBe(created.whatsapp_url);
    expect(verdict(candidate(ctxA, "self"), rich.m5k)).toMatchObject({ eligible: false, code: "PARTICIPANT_ALREADY_HELD" });

    // One effective PENDING request per buyer + Edition: a second request (other participant) is a CONFLICT.
    const second = await appError(
      createRegistrationRequest(
        a.client,
        { edition_id: rich.editionId, participants: [{ kind: "GUEST", guest_participant_id: aGuest.guest_participant_id, modality_id: rich.m10k, category_id: rich.catLibre, responses: RESPONSES }], legal_acceptances: accept(0) },
        null,
      ),
    );
    expect(second.code).toBe("CONFLICT");
    expect(second.details.reason).toBe("PENDING_REQUEST_EXISTS");
    expect(second.details.registration_request_id).toBe(created.registration_request_id);

    // B sees the 5K held by A: TEMPORARILY_UNAVAILABLE, distinct from SOLD_OUT (Master §36).
    const ctxB1 = await context(b, rich.slug);
    expect(ctxB1.modalities.find((m) => m.modality_id === rich.m5k)).toMatchObject({ availability_state: "TEMPORARILY_UNAVAILABLE", registrable: false, unavailable_reason: "TEMPORARILY_UNAVAILABLE" });
    expect(ctxB1.modalities.find((m) => m.modality_id === rich.m10k)!.registrable).toBe(true);
    const lost = await appError(
      createRegistrationRequest(b.client, { edition_id: rich.editionId, participants: [{ kind: "PROFILE", public_profile_id: b.publicProfileId!, modality_id: rich.m5k, responses: RESPONSES }], legal_acceptances: accept(0) }, null),
    );
    expect(lost.code).toBe("CAPACITY_UNAVAILABLE");

    // Cancelling frees the slot immediately; B sees it AVAILABLE again.
    await cancelRegistrationRequest(a.client, created.registration_request_id, undefined, null);
    expect((await context(b, rich.slug)).modalities.find((m) => m.modality_id === rich.m5k)!.availability_state).toBe("AVAILABLE");

    // A new request, confirmed by staff: the 5K is now SOLD_OUT, and A has a registration with their own pass.
    const again = await createRegistrationRequest(
      a.client,
      { edition_id: rich.editionId, participants: [{ kind: "PROFILE", public_profile_id: a.publicProfileId!, modality_id: rich.m5k, responses: RESPONSES }], legal_acceptances: accept(0) },
      null,
    );
    const confirmed = await confirmRegistrationRequest(admin.client, again.registration_request_id, null);
    expect(confirmed.status).toBe("CONFIRMED");
    const ctxB2 = await context(b, rich.slug);
    expect(ctxB2.modalities.find((m) => m.modality_id === rich.m5k)).toMatchObject({ availability_state: "SOLD_OUT", registrable: false, unavailable_reason: "SOLD_OUT" });

    const ctxA2 = await context(a, rich.slug);
    expect(ctxA2.existing.pending_request).toBeNull();
    expect(ctxA2.existing.registrations).toHaveLength(1);
    expect(ctxA2.existing.registrations[0]).toMatchObject({ status: "CONFIRMED", is_titular: true, modality: { modality_id: rich.m5k } });
    expect(ctxA2.existing.registrations[0]!.participant_pass_id).toBeTruthy();
    expect(verdict(candidate(ctxA2, "self"), rich.m5k)).toMatchObject({ eligible: false, code: "DUPLICATE_REGISTRATION" });
  }, 120_000);

  test("P2-AC-08.a / P2-AC-03.a: FREE confirms in one transaction with registration + pass ids; a Friend's acceptance (made by the Friend) unlocks the group; no hold, no payment", async () => {
    const rich = await buildRich("FREE");
    const buyer = await user("free-group");
    const friend = await user("free-group-friend");
    const friendship = await requestFriendship(buyer.client, friend.publicProfileId!, null);
    await respondFriendship(friend.client, friendship.friendship_id, "accept");

    const ctx = await context(buyer, rich.slug);
    expect(ctx.hold).toBeNull();
    expect(ctx.whatsapp).toBeNull();
    expect(ctx.modalities.find((m) => m.modality_id === rich.m5k)!.price).toMatchObject({ amount_minor: 0, source: "FREE", price_offer_id: null });

    const friendCandidate = candidate(ctx, `profile:${friend.publicProfileId}`);
    expect(friendCandidate.acceptance.missing_document_version_ids.sort()).toEqual([rich.waiverId, rich.rulesId].sort());
    const body = (accept: boolean) => ({
      edition_id: rich.editionId,
      participants: [
        { kind: "PROFILE" as const, public_profile_id: buyer.publicProfileId!, modality_id: rich.m10k, category_id: rich.catLibre, responses: { shirt_size: "M" } },
        { kind: "PROFILE" as const, public_profile_id: friend.publicProfileId!, modality_id: rich.m10k, category_id: rich.catLibre, responses: { shirt_size: "S" } },
      ],
      legal_acceptances: [rich.waiverId, rich.rulesId].map((legal_document_version_id) => ({ participant_index: 0, legal_document_version_id })).concat(
        accept ? [rich.waiverId, rich.rulesId].map((legal_document_version_id) => ({ participant_index: 1, legal_document_version_id })) : [],
      ),
    });

    // The buyer cannot accept for an adult Friend (Master §124): FREE (no later staff step) refuses.
    const blocked = await appError(createRegistrationRequest(buyer.client, body(true), null));
    expect(blocked.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    const withoutFriend = await appError(createRegistrationRequest(buyer.client, body(false), null));
    expect(withoutFriend.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(JSON.stringify(withoutFriend.details)).toContain("PARTICIPANT_ACCEPTANCE_PENDING");

    // The Friend accepts personally (pending action), the context reflects it, the group confirms inline.
    await acceptEditionDocuments(friend.client, rich.editionId, [rich.waiverId, rich.rulesId], undefined, undefined);
    expect(candidate(await context(buyer, rich.slug), `profile:${friend.publicProfileId}`).acceptance.missing_document_version_ids).toEqual([]);
    const view = await createRegistrationRequest(buyer.client, body(false), null);
    expect(view.status).toBe("CONFIRMED");
    expect(view.registration_mode).toBe("FREE");
    expect(view.expires_at).toBeNull(); // FREE: no hold at all
    expect(view.whatsapp_phone_e164).toBeNull();
    expect(view.whatsapp_url).toBeNull();
    expect(view.total_snapshot_minor).toBe(0);
    const own = view.participants.find((p) => p.is_buyer)!;
    expect(own.registration?.registration_id).toBeTruthy();
    expect(own.registration?.participant_pass_id).toBeTruthy();
    // A Friend's pass id is never handed to the buyer (Master §84).
    const theirs = view.participants.find((p) => !p.is_buyer)!;
    expect(theirs.registration?.status).toBe("CONFIRMED");
    expect(theirs.registration?.participant_pass_id).toBeNull();
    expect(queryValue(`select count(*)::int from app.registration_hold where registration_request_id = '${view.registration_request_id}'`)).toBe("0");

    // Event documents for a minor Guest need the guardian's acceptance of MINOR_TERMS too (per participant).
    const minor = await createGuest(buyer.client, guestFields("Menor Guest", dobForAge(16), "+528110004631"), null);
    await createGuardianAssignment(buyer.client, { minor_kind: "GUEST", guest_participant_id: minor.guest_participant_id, relationship_type: "PARENT" });
    const noMinorTerms = await appError(
      createRegistrationRequest(
        buyer.client,
        {
          edition_id: rich.editionId,
          participants: [{ kind: "GUEST", guest_participant_id: minor.guest_participant_id, modality_id: rich.m5k, responses: RESPONSES }],
          legal_acceptances: [rich.waiverId, rich.rulesId].map((legal_document_version_id) => ({ participant_index: 0, legal_document_version_id })),
        },
        null,
      ),
    );
    expect(noMinorTerms.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(JSON.stringify(noMinorTerms.details)).toContain(rich.minorTermsId);
  }, 120_000);

  test("registration window and publication states: blocking_code mirrors create_registration_request; historical slug redirects; unknown/unauthenticated are refused", async () => {
    const rich = await buildRich("FREE");
    const buyer = await user("window");

    await transitionEdition(admin.client, "pause-registration", rich.editionId, { reason: "prueba de contexto" }, null);
    const paused = await context(buyer, rich.slug);
    expect(paused.registration).toMatchObject({ can_register: false, blocking_code: "REGISTRATION_NOT_OPEN" });
    expect(paused.modalities.length).toBe(4); // the rest of the read model is still served
    await transitionEdition(admin.client, "resume-registration", rich.editionId, {}, null);
    expect((await context(buyer, rich.slug)).registration.can_register).toBe(true);

    await transitionEdition(admin.client, "close-registration", rich.editionId, { reason: "prueba de contexto" }, null);
    expect((await context(buyer, rich.slug)).registration).toMatchObject({ can_register: false, blocking_code: "REGISTRATION_CLOSED" });

    expect(await getRegistrationContext(buyer.client, "no-such-slug-ctx")).toBeNull();

    const newSlug = `${rich.slug}-v2`;
    await updateEdition(admin.client, rich.editionId, { slug: newSlug });
    expect(await getRegistrationContext(buyer.client, rich.slug)).toEqual({ redirect: true, slug: newSlug });
    expect((await context(buyer, newSlug)).edition.slug).toBe(newSlug);

    // A DRAFT edition never resolves (no existence oracle).
    const event = await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: "Borrador", canonical_key: `ctx-draft-${randomUUID().slice(0, 8)}` }, null);
    const draft = await createEdition(admin.client, event.event_id, { slug: `ctx-draft-${randomUUID().slice(0, 8)}`, name: "Borrador", registration_mode: "FREE", city: "Monterrey", state_region: "NL", schedule: { local_date: isoDatePlus(60) } }, null);
    expect(await getRegistrationContext(buyer.client, draft.slug)).toBeNull();

    // Not READY (still onboarding) is PROFILE_INCOMPLETE, not a context (the HTTP route also guards "ready").
    const incomplete = await createTestUser({ label: "ctx-incomplete", ready: false });
    authUserIds.push(incomplete.authUserId);
    const notReady = await appError(getRegistrationContext(incomplete.client, rich.slug));
    expect(notReady.code).toBe("PROFILE_INCOMPLETE");
  }, 120_000);

  test("rate limit: registration.context is bounded per user (RATE_LIMITED)", async () => {
    const rich = await buildRich("FREE");
    const buyer = await user("rate");
    sql(`delete from infra.rate_limit_counter where scope in ('registration.context', 'registration.context:cmd')`);
    // 120 / 10 min for the pre-check scope: the 121st call inside the window is refused with a retry hint.
    for (let i = 0; i < 120; i++) await getRegistrationContext(buyer.client, rich.slug);
    const limited = await appError(getRegistrationContext(buyer.client, rich.slug));
    expect(limited.code).toBe("RATE_LIMITED");
    expect(limited.status).toBe(429);
    sql(`delete from infra.rate_limit_counter where scope in ('registration.context', 'registration.context:cmd')`);
  }, 180_000);
});
