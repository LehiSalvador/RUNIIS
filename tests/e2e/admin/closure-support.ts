import { randomBytes, randomUUID } from "node:crypto";
import { psql } from "../support/account";

/**
 * Attendance, finalization and closure fixtures (P3-I): FINISHED Editions with confirmed registrations, check-in evidence and runner accounts, written
 * with direct SQL into the LOCAL Docker database (the helper refuses a remote target). Each call seeds a fresh set under its own Event
 * (`QA Cierre <suffix>`), so the three viewport projects never share a participant and the seeded Edition list stays untouched.
 *
 * - `flow`   : the main journey (7 registrations, two modalities, one runner with a check-in and one guest with a check-in).
 * - `race`   : two guests with check-in evidence and nothing pending: finalize and close are ready (concurrency and refusals).
 * - `early`  : a SCHEDULED Edition (not finished): finalization is not ready.
 * - `large`  : 130 confirmed guests (pagination, search).
 * - `perms`  : a ready Edition for the role checks (an Edition-scoped admin reads, never closes).
 */
const MONTERREY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey", year: "numeric", month: "2-digit", day: "2-digit" });
const monterreyDate = (days: number) => MONTERREY.format(new Date(Date.now() + days * 86_400_000));
const STAFF_ID = "20000000-0000-4000-8000-000000340001"; // seeded OPERATOR; only the author of the check-in rows
const reference = () => `R-${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;

export type Person = { key: string; name: string; number: string; registrationId: string; kind: "PROFILE" | "GUEST" };
export type SeededEdition = { editionId: string; name: string; modalities: Record<string, string>; people: Record<string, Person> };

export type SeededClosure = {
  suffix: string;
  flow: SeededEdition;
  race: SeededEdition;
  early: SeededEdition;
  large: SeededEdition;
  perms: SeededEdition;
};

type PersonSpec = { key: string; label: string; kind: "PROFILE" | "GUEST"; modality: string; checkin?: boolean };

export function seedClosure(): SeededClosure {
  const suffix = randomBytes(3).toString("hex");
  const numberPrefix = randomBytes(2).toString("hex").toUpperCase();
  const eventId = randomUUID();
  const statements: string[] = [
    `insert into app.event (event_id, event_type_id, name, canonical_key)
     select '${eventId}', event_type_id, 'QA Cierre ${suffix}', 'qa-cierre-${suffix}' from app.event_type where key = 'ROAD_RACE';`,
  ];
  let counter = 0;

  function edition(label: string, state: "FINISHED" | "SCHEDULED", modalities: { key: string; name: string; meters: number; credit?: boolean }[]) {
    const id = randomUUID();
    const name = `QA Cierre ${label} ${suffix}`;
    const mods: Record<string, string> = {};
    statements.push(`
      insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, closure_state,
        registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at)
      values ('${id}', '${eventId}', 'qa-cierre-${label.toLowerCase()}-${suffix}', '${name}', 'PUBLISHED', '${state}', 'CLOSED', '${state === "FINISHED" ? "PENDING" : "OPEN"}', 'FREE',
        'America/Monterrey', now() - interval '40 days', now() - interval '10 days', 'Monterrey', 'NL', 'MX', now());
      insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state, local_date, local_start_time,
        timezone, effective_start_at, created_by_staff_id)
      values ('${randomUUID()}', '${id}', 1, 'DATE_TIME_CONFIRMED', date '${monterreyDate(state === "FINISHED" ? -1 : 30)}', '07:00:00', 'America/Monterrey',
        (date '${monterreyDate(state === "FINISHED" ? -1 : 30)}' + time '07:00:00') at time zone 'America/Monterrey', '${STAFF_ID}');`);
    modalities.forEach((modality, index) => {
      const modalityId = randomUUID();
      mods[modality.key] = modalityId;
      statements.push(`
        insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order)
        values ('${modalityId}', '${id}', '${modality.key}', '${modality.name}', ${modality.meters}, ${modality.credit === false ? "false" : "true"}, 'ACTIVE', ${index + 1});
        insert into app.modality_capacity (modality_id, effective_capacity) values ('${modalityId}', 1000);`);
    });
    return { id, name, mods };
  }

  function people(ed: { id: string; mods: Record<string, string> }, specs: PersonSpec[]): Record<string, Person> {
    const out: Record<string, Person> = {};
    for (const spec of specs) {
      counter += 1;
      const profile = randomUUID();
      const authId = randomUUID();
      const guest = randomUUID();
      const request = randomUUID();
      const participant = randomUUID();
      const registration = randomUUID();
      const name = `QA ${spec.label} ${suffix}`;
      const number = `I-${numberPrefix}-${String(counter).padStart(4, "0")}`;
      // The buyer is always a runner profile (a Guest is registered by its owner); a PROFILE participant is that same profile.
      statements.push(`
        insert into auth.users (id, email) values ('${authId}', 'qa-cierre-${suffix}-${counter}@example.test');
        insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name, date_of_birth, sex_code, phone_e164,
          emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
        values ('${profile}', '${authId}', 'READY', 'ACTIVE', '${spec.kind === "PROFILE" ? name : `QA Comprador ${counter} ${suffix}`}', '1985-01-01', 'M',
          '+5281100${String(70000 + counter).slice(-5)}', 'Contacto', '+528110005002', 'Hermano', now());
        insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, status, registration_mode,
          currency, total_snapshot_minor, confirmed_at, created_at)
        values ('${request}', '${reference()}', '${profile}', '${ed.id}', 'CONFIRMED', 'FREE', 'MXN', 0, now() - interval '30 days', now() - interval '31 days');`);
      if (spec.kind === "GUEST") {
        statements.push(`
          insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
            emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
          values ('${guest}', '${profile}', '${name}', '1990-01-01', 'X', '+528110005003', 'Contacto', '+528110005004', 'Amigo');
          insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, guest_participant_id,
            modality_id, price_snapshot_minor, currency, eligibility_snapshot)
          values ('${participant}', '${request}', 'GUEST', '${guest}', '${ed.mods[spec.modality]}', 0, 'MXN', jsonb_build_object('is_minor', false));
          insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id, guest_participant_id,
            buyer_profile_id, registration_number, status, confirmed_at)
          values ('${registration}', '${request}', '${participant}', '${ed.id}', '${ed.mods[spec.modality]}', '${guest}', '${profile}', '${number}', 'CONFIRMED', now() - interval '30 days');`);
      } else {
        statements.push(`
          insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, runner_profile_id,
            modality_id, price_snapshot_minor, currency, eligibility_snapshot)
          values ('${participant}', '${request}', 'PROFILE', '${profile}', '${ed.mods[spec.modality]}', 0, 'MXN', jsonb_build_object('is_minor', false));
          insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id, runner_profile_id,
            buyer_profile_id, registration_number, status, confirmed_at)
          values ('${registration}', '${request}', '${participant}', '${ed.id}', '${ed.mods[spec.modality]}', '${profile}', '${profile}', '${number}', 'CONFIRMED', now() - interval '30 days');`);
      }
      if (spec.checkin) {
        statements.push(`
          insert into app.attendance_checkin (edition_id, registration_id, status, verification_method, checked_in_by_staff_id)
          values ('${ed.id}', '${registration}', 'VERIFIED_PRESENT', 'QR_SCAN', '${STAFF_ID}');`);
      }
      out[spec.key] = { key: spec.key, name, number, registrationId: registration, kind: spec.kind };
    }
    return out;
  }

  const flow = edition("Flujo", "FINISHED", [
    { key: "10k", name: "10K", meters: 10000 },
    { key: "5k", name: "5K", meters: 5000 },
  ]);
  const flowPeople = people(flow, [
    { key: "checkin", label: "Con Check-in", kind: "PROFILE", modality: "10k", checkin: true },
    { key: "pend1", label: "Pendiente Uno", kind: "PROFILE", modality: "5k" },
    { key: "pend2", label: "Pendiente Dos", kind: "PROFILE", modality: "10k" },
    { key: "pend3", label: "Pendiente Tres", kind: "PROFILE", modality: "10k" },
    { key: "pend4", label: "Pendiente Cuatro", kind: "PROFILE", modality: "5k" },
    { key: "guestCheckin", label: "Invitado Con Check-in", kind: "GUEST", modality: "10k", checkin: true },
    { key: "guestPend", label: "Invitado Pendiente", kind: "GUEST", modality: "5k" },
  ]);

  const race = edition("Carrera", "FINISHED", [{ key: "10k", name: "10K", meters: 10000 }]);
  const racePeople = people(race, [
    { key: "a", label: "Carrera Uno", kind: "GUEST", modality: "10k", checkin: true },
    { key: "b", label: "Carrera Dos", kind: "GUEST", modality: "10k", checkin: true },
  ]);

  const early = edition("Temprana", "SCHEDULED", [{ key: "10k", name: "10K", meters: 10000 }]);
  const earlyPeople = people(early, [
    { key: "a", label: "Temprana Uno", kind: "GUEST", modality: "10k" },
    { key: "b", label: "Temprana Dos", kind: "GUEST", modality: "10k" },
  ]);

  const large = edition("Grande", "FINISHED", [{ key: "10k", name: "10K", meters: 10000 }]);
  const largeSpecs: PersonSpec[] = Array.from({ length: 130 }, (_, index) => ({
    key: `g${index + 1}`,
    label: `Grande ${String(index + 1).padStart(3, "0")}`,
    kind: "GUEST",
    modality: "10k",
    checkin: index < 20,
  }));
  const largePeople = people(large, largeSpecs);

  const perms = edition("Permisos", "FINISHED", [{ key: "10k", name: "10K", meters: 10000 }]);
  const permsPeople = people(perms, [
    { key: "a", label: "Permisos Uno", kind: "PROFILE", modality: "10k", checkin: true },
    { key: "b", label: "Permisos Dos", kind: "GUEST", modality: "10k", checkin: true },
  ]);

  psql(statements.join("\n"));

  const wrap = (ed: { id: string; name: string; mods: Record<string, string> }, who: Record<string, Person>): SeededEdition => ({
    editionId: ed.id,
    name: ed.name,
    modalities: ed.mods,
    people: who,
  });
  return {
    suffix,
    flow: wrap(flow, flowPeople),
    race: wrap(race, racePeople),
    early: wrap(early, earlyPeople),
    large: wrap(large, largePeople),
    perms: wrap(perms, permsPeople),
  };
}

/** A fresh account that becomes an Edition-scoped ADMIN of `editionId` (the role assignment is written by SQL; the sign-in is the real flow). */
export function assignScopedAdmin(email: string, editionId: string): string {
  if (!/^[a-z0-9.@-]+$/.test(email)) throw new Error("refusing a non fixture address");
  const staffId = randomUUID();
  psql(`
    insert into app.staff_member (staff_member_id, auth_user_id, status) select '${staffId}', id, 'ACTIVE' from auth.users where lower(email) = lower('${email}');
    insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id) values ('${staffId}', 'ADMIN', 'EDITION', '${editionId}');`);
  return staffId;
}

/** Current (not superseded) attendance of a registration, read straight from the database. */
export function attendanceRow(registrationId: string): { status: string; source: string; reason: string; evidence: string } {
  const out = psql(
    `select status || '|' || source || '|' || coalesce(reason, '') || '|' || coalesce(evidence_metadata::text, '')
     from app.attendance_resolution where registration_id = '${registrationId}' and superseded_at is null`,
  );
  const [status, source, reason, evidence] = out.split("|");
  return { status, source, reason, evidence };
}

export function eligibilityRow(registrationId: string): { status: string; disposition: string } {
  const out = psql(
    `select status || '|' || distance_credit_disposition from app.sporting_eligibility_resolution where registration_id = '${registrationId}' and superseded_at is null`,
  );
  const [status, disposition] = out.split("|");
  return { status, disposition };
}

export function creditCounts(editionId: string): { active: number; reversed: number; guests: number; linked: number } {
  const out = psql(
    `select count(*) filter (where dc.status = 'ACTIVE') || '|' || count(*) filter (where dc.status = 'REVERSED') || '|' ||
            count(*) filter (where dc.status = 'ACTIVE' and exists (select 1 from app.registration r where r.registration_id = dc.registration_id and r.guest_participant_id is not null)) || '|' ||
            count(*) filter (where dc.supersedes_distance_credit_id is not null)
     from app.distance_credit dc where dc.edition_id = '${editionId}'`,
  );
  const [active, reversed, guests, linked] = out.split("|").map(Number);
  return { active, reversed, guests, linked };
}

export function currentFinalizationRevision(editionId: string): number | null {
  const out = psql(`select revision from app.attendance_finalization where edition_id = '${editionId}' and superseded_at is null and status = 'FINALIZED'`);
  return out === "" ? null : Number(out);
}
