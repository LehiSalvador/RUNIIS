import { randomBytes, randomUUID } from "node:crypto";
import { psql } from "../support/account";

/**
 * Fixtures of the request queue and participant administration (P3-G), written with direct SQL into the LOCAL Docker database. Every call
 * seeds one fresh EXTERNAL_WHATSAPP Edition (and a second one whose attendance is already finalized), so the three viewport projects never
 * share a request or a participant. Nothing is deleted afterwards (the schema forbids deleting registrations): the data lives under a
 * `qa-requests-<suffix>` slug and `qa-requests-<suffix>-*@example.test` addresses, synthetic and local only.
 *
 * Every request has its OWN buyer (the database allows one effective PENDING request per buyer and Edition) and its own guest participants.
 * The participants' legal acceptances are written the way the system records them, for exactly the documents the Edition requires, so a
 * request is confirmable unless the test says otherwise ("legal" leaves its guest without them).
 */
const STAFF_ID = "20000000-0000-4000-8000-000000340001"; // seeded OPERATOR

const chunk = () => randomBytes(2).toString("hex").toUpperCase();
const reference = () => `R-${chunk()}-${chunk()}`;

export type SeededRequest = {
  requestId: string;
  reference: string;
  buyerName: string;
  guestNames: string[];
};

export type SeededRequests = {
  suffix: string;
  editionId: string;
  editionName: string;
  /** Second Edition: attendance already finalized (cancel and change modality answer CLOSURE_BLOCKED). */
  finalizedEditionId: string;
  finalizedEditionName: string;
  modality10Id: string;
  modality21Id: string;
  requests: Record<"confirm" | "legal" | "cancel" | "bulkA" | "bulkB" | "bulkC" | "confirmed" | "expired" | "hoarder", SeededRequest>;
  /** Confirmed registrations by role. */
  participants: Record<"queued" | "noContact" | "suppressed" | "change" | "full" | "blocked", { registrationId: string; name: string; number: string; code: string; buyerName: string }>;
};

type RequestSpec = {
  key: keyof SeededRequests["requests"];
  guests: number;
  status?: "PENDING_CONFIRMATION" | "CONFIRMED";
  /** minutes until expiry (negative: already past, status still PENDING in the database) */
  expiresInMinutes?: number;
  acceptLegal?: boolean;
  /** snapshot differs from the current price offer (so a revalidation reports PRICE_CHANGED) */
  staleSnapshot?: boolean;
  createdMinutesAgo?: number;
};

const REQUESTS: RequestSpec[] = [
  { key: "confirm", guests: 1, expiresInMinutes: 90, createdMinutesAgo: 10 },
  { key: "legal", guests: 1, expiresInMinutes: 90, acceptLegal: false, createdMinutesAgo: 20 },
  { key: "cancel", guests: 2, expiresInMinutes: 90, createdMinutesAgo: 30 },
  { key: "bulkA", guests: 1, expiresInMinutes: 90, createdMinutesAgo: 40 },
  { key: "bulkB", guests: 2, expiresInMinutes: 90, createdMinutesAgo: 50 },
  { key: "bulkC", guests: 1, expiresInMinutes: 90, createdMinutesAgo: 60 },
  { key: "confirmed", guests: 1, status: "CONFIRMED", expiresInMinutes: -60, createdMinutesAgo: 300 },
  // Past its expiry but still PENDING in the database (the worker has not run): the queue must read it as expired.
  { key: "expired", guests: 1, expiresInMinutes: -45, staleSnapshot: true, createdMinutesAgo: 1500 },
  // Ten places held by one account: crosses the single-buyer threshold of the hold-concentration alert.
  { key: "hoarder", guests: 10, expiresInMinutes: 120, createdMinutesAgo: 5 },
];

const MONTERREY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey", year: "numeric", month: "2-digit", day: "2-digit" });
const monterreyDate = (days: number) => MONTERREY.format(new Date(Date.now() + days * 86_400_000));

export function seedRequests(): SeededRequests {
  const suffix = randomBytes(3).toString("hex");
  const numberPrefix = chunk();
  const ids = {
    A: randomUUID(),
    B: randomUUID(),
    mod10: randomUUID(),
    mod21: randomUUID(),
    mod5: randomUUID(),
    modB: randomUUID(),
    modB21: randomUUID(),
    offer10: randomUUID(),
    offer21: randomUUID(),
    offer5: randomUUID(),
    offerB: randomUUID(),
    offerB21: randomUUID(),
  };
  const editionName = `QA Solicitudes ${suffix}`;
  const finalizedEditionName = `QA Finalizada ${suffix}`;
  // Its own Event: hanging QA Editions from the seeded "Seed Carrera Registro" Event would push the seeded Edition off the first page of every
  // list that searches for "Seed" (the events list specs do).
  const eventId = randomUUID();
  const statements: string[] = [
    `insert into app.event (event_id, event_type_id, name, canonical_key)
     select '${eventId}', event_type_id, 'QA Solicitudes ${suffix}', 'qa-solicitudes-${suffix}' from app.event_type where key = 'ROAD_RACE';`,
  ];

  const edition = (id: string, slug: string, name: string, mode: "EXTERNAL_WHATSAPP") => `
    insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, closure_state,
      registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, whatsapp_phone_e164, published_at)
    values ('${id}', '${eventId}', '${slug}', '${name}', 'PUBLISHED', 'SCHEDULED', 'OPEN', 'OPEN', '${mode}', 'America/Monterrey',
      now() - interval '5 days', now() + interval '55 days', 'Monterrey', 'NL', 'MX', '+528110000099', now());
    insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state, local_date, local_start_time,
      timezone, effective_start_at, created_by_staff_id)
    values ('${randomUUID()}', '${id}', 1, 'DATE_TIME_CONFIRMED', date '${monterreyDate(20)}', '07:00:00', 'America/Monterrey',
      (date '${monterreyDate(20)}' + time '07:00:00') at time zone 'America/Monterrey', '${STAFF_ID}');`;
  const modality = (id: string, editionId: string, key: string, name: string, meters: number, offer: string, price: number, capacity: number) => `
    insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order)
    values ('${id}', '${editionId}', '${key}', '${name}', ${meters}, true, 'ACTIVE', ${key === "10k" ? 1 : 2});
    insert into app.modality_capacity (modality_id, effective_capacity) values ('${id}', ${capacity});
    insert into app.price_offer (price_offer_id, modality_id, name, amount_minor, currency) values ('${offer}', '${id}', 'General', ${price}, 'MXN');`;

  statements.push(edition(ids.A, `qa-requests-${suffix}`, editionName, "EXTERNAL_WHATSAPP"));
  statements.push(modality(ids.mod10, ids.A, "10k", "10K", 10000, ids.offer10, 35000, 100));
  statements.push(modality(ids.mod21, ids.A, "21k", "21K", 21097, ids.offer21, 60000, 100));
  // A one-place modality, taken by the "full" participant below: moving someone there answers CAPACITY_UNAVAILABLE.
  statements.push(modality(ids.mod5, ids.A, "5k", "5K", 5000, ids.offer5, 25000, 1));
  statements.push(edition(ids.B, `qa-requests-fin-${suffix}`, finalizedEditionName, "EXTERNAL_WHATSAPP"));
  statements.push(modality(ids.modB, ids.B, "10k", "10K", 10000, ids.offerB, 35000, 100));
  statements.push(modality(ids.modB21, ids.B, "21k", "21K", 21097, ids.offerB21, 60000, 100));

  let counter = 0;
  /** A buyer with (or without) an email: the cancellation email outcome follows from it. */
  function buyer(label: string, withEmail = true) {
    counter += 1;
    const authId = randomUUID();
    const profile = randomUUID();
    const name = `QA ${label} ${suffix}`;
    const email = `qa-requests-${suffix}-${counter}@example.test`;
    statements.push(`
      insert into auth.users (id, email${withEmail ? ", email_confirmed_at" : ""}) values ('${authId}', ${withEmail ? `'${email}', now()` : "null"});
      insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name, date_of_birth, sex_code, phone_e164,
        emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
      values ('${profile}', '${authId}', 'READY', 'ACTIVE', '${name}', '1985-01-01', 'M', '+5281100${String(60000 + counter).slice(-5)}',
        'Contacto', '+528110005002', 'Hermano', now());`);
    return { profile, name, email };
  }

  const requests = {} as SeededRequests["requests"];
  for (const spec of REQUESTS) {
    const who = buyer(`Comprador ${spec.key}`);
    const request = randomUUID();
    const ref = reference();
    const guestNames: string[] = [];
    const confirmed = spec.status === "CONFIRMED";
    const minutes = spec.expiresInMinutes ?? 90;
    const created = spec.createdMinutesAgo ?? 10;
    const snapshot = spec.staleSnapshot ? 30000 : 35000;
    statements.push(`
      insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, status, registration_mode, currency,
        total_snapshot_minor, whatsapp_phone_snapshot, expires_at, confirmed_at, created_at)
      values ('${request}', '${ref}', '${who.profile}', '${ids.A}', '${confirmed ? "CONFIRMED" : "PENDING_CONFIRMATION"}', 'EXTERNAL_WHATSAPP', 'MXN',
        ${snapshot * spec.guests}, '+528110000099', now() + interval '${minutes} minutes', ${confirmed ? "now() - interval '3 hours'" : "null"},
        now() - interval '${created} minutes');`);
    for (let index = 0; index < spec.guests; index += 1) {
      const guest = randomUUID();
      const participant = randomUUID();
      const name = `QA ${spec.key} Invitado ${index + 1} ${suffix}`;
      guestNames.push(name);
      statements.push(`
        insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
          emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
        values ('${guest}', '${who.profile}', '${name}', '1990-01-01', 'X', '+528110005003', 'Contacto', '+528110005004', 'Amigo');
        insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, guest_participant_id,
          modality_id, price_offer_id, price_snapshot_minor, currency, eligibility_snapshot, created_at)
        values ('${participant}', '${request}', 'GUEST', '${guest}', '${ids.mod10}', '${ids.offer10}', ${snapshot}, 'MXN', jsonb_build_object('is_minor', false),
          now() - interval '${created} minutes' + interval '${index} milliseconds');`);
      if (confirmed) {
        const registration = randomUUID();
        statements.push(`
          insert into app.registration_confirmation (registration_request_id, confirmation_method, confirmed_by_staff_id)
          values ('${request}', 'EXTERNAL_WHATSAPP', '${STAFF_ID}');
          insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id, guest_participant_id,
            buyer_profile_id, registration_number, status, confirmed_at)
          values ('${registration}', '${request}', '${participant}', '${ids.A}', '${ids.mod10}', '${guest}', '${who.profile}',
            'I-${numberPrefix}-${String(900 + counter).padStart(4, "0")}', 'CONFIRMED', now() - interval '3 hours');`);
      } else if (minutes > 0) {
        statements.push(`
          insert into app.registration_participant_claim (edition_id, registration_request_id, request_participant_id, guest_participant_id, expires_at)
          values ('${ids.A}', '${request}', '${participant}', '${guest}', now() + interval '${minutes} minutes');`);
      }
      if (spec.acceptLegal !== false) {
        statements.push(`
          insert into app.legal_acceptance (runner_profile_id, legal_document_version_id, edition_id, registration_request_id, participant_runner_profile_id,
            guardian_assignment_id, acceptance_context)
          select '${who.profile}', req.legal_document_version_id, '${ids.A}', '${request}', null, null, jsonb_build_object('source', 'qa-fixture', 'guest_participant_id', '${guest}'::text)
          from private.registration_required_documents('${ids.A}', false) req;`);
      }
    }
    if (!confirmed && minutes > 0) {
      statements.push(`
        insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at)
        values ('${request}', '${ids.mod10}', ${spec.guests}, now() + interval '${minutes} minutes');`);
    }
    requests[spec.key] = { requestId: request, reference: ref, buyerName: who.name, guestNames };
  }

  // The 10K price moved since the "expired" request was made (30000 -> 35000 per place): its revalidation must report PRICE_CHANGED.

  // ---- Confirmed participants ---------------------------------------------------------------------------------------------------
  const participants = {} as SeededRequests["participants"];
  type Plan = { key: keyof SeededRequests["participants"]; edition: "A" | "B"; email: boolean; suppress?: boolean; modality?: "5k" };
  const plans: Plan[] = [
    { key: "queued", edition: "A", email: true },
    { key: "noContact", edition: "A", email: false },
    { key: "suppressed", edition: "A", email: true, suppress: true },
    { key: "change", edition: "A", email: true },
    { key: "full", edition: "A", email: true, modality: "5k" },
    { key: "blocked", edition: "B", email: true },
  ];
  plans.forEach((plan, index) => {
    const who = buyer(`Compra ${plan.key}`, plan.email);
    const guest = randomUUID();
    const request = randomUUID();
    const participant = randomUUID();
    const registration = randomUUID();
    const pass = randomUUID();
    const editionId = plan.edition === "A" ? ids.A : ids.B;
    const modalityId = plan.modality === "5k" ? ids.mod5 : plan.edition === "A" ? ids.mod10 : ids.modB;
    const offerId = plan.modality === "5k" ? ids.offer5 : plan.edition === "A" ? ids.offer10 : ids.offerB;
    const name = `QA Inscrito ${plan.key} ${suffix}`;
    const number = `I-${numberPrefix}-${String(index + 1).padStart(4, "0")}`;
    const code = `P-${numberPrefix}-${String(index + 1).padStart(4, "0")}`;
    statements.push(`
      insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
        emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
      values ('${guest}', '${who.profile}', '${name}', '1990-01-01', 'X', '+528110005003', 'Contacto', '+528110005004', 'Amigo');
      insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, status, registration_mode, currency,
        total_snapshot_minor, whatsapp_phone_snapshot, expires_at, confirmed_at, created_at)
      values ('${request}', '${reference()}', '${who.profile}', '${editionId}', 'CONFIRMED', 'EXTERNAL_WHATSAPP', 'MXN', 35000, '+528110000099',
        now() - interval '4 hours', now() - interval '3 hours', now() - interval '5 hours');
      insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, guest_participant_id,
        modality_id, price_offer_id, price_snapshot_minor, currency, eligibility_snapshot)
      values ('${participant}', '${request}', 'GUEST', '${guest}', '${modalityId}', '${offerId}', 35000, 'MXN', jsonb_build_object('is_minor', false));
      insert into app.registration_confirmation (registration_request_id, confirmation_method, confirmed_by_staff_id)
      values ('${request}', 'EXTERNAL_WHATSAPP', '${STAFF_ID}');
      insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id, guest_participant_id,
        buyer_profile_id, registration_number, status, confirmed_at)
      values ('${registration}', '${request}', '${participant}', '${editionId}', '${modalityId}', '${guest}', '${who.profile}', '${number}', 'CONFIRMED',
        now() - interval '3 hours');
      insert into app.participant_pass (participant_pass_id, registration_id, public_code) values ('${pass}', '${registration}', '${code}');`);
    if (plan.suppress) {
      statements.push(`
        insert into app.communication_recipient (recipient_type, runner_profile_id) values ('RUNNER', '${who.profile}') on conflict (runner_profile_id) do nothing;
        insert into app.communication_contact_point (communication_recipient_id, channel, value_normalized, verification_status, verified_at, is_primary)
        select r.communication_recipient_id, 'EMAIL', lower('${who.email}'), 'VERIFIED', now(), true
        from app.communication_recipient r where r.runner_profile_id = '${who.profile}';
        insert into app.communication_suppression (contact_point_id, reason, scope, source)
        select cp.communication_contact_point_id, 'HARD_BOUNCE', 'ALL_EMAIL', 'QA_FIXTURE'
        from app.communication_contact_point cp join app.communication_recipient r on r.communication_recipient_id = cp.communication_recipient_id
        where r.runner_profile_id = '${who.profile}';`);
    }
    participants[plan.key] = { registrationId: registration, name, number, code, buyerName: who.name };
  });

  // Attendance of the second Edition is already finalized: cancel and change modality answer CLOSURE_BLOCKED there.
  statements.push(`
    insert into app.attendance_finalization (edition_id, revision, expected_count, present_count, no_show_count, excluded_count, finalized_by_staff_id)
    values ('${ids.B}', 1, 1, 0, 1, 0, '${STAFF_ID}');`);

  psql(statements.join("\n"));

  return {
    suffix,
    editionId: ids.A,
    editionName,
    finalizedEditionId: ids.B,
    finalizedEditionName,
    modality10Id: ids.mod10,
    modality21Id: ids.mod21,
    requests,
    participants,
  };
}
