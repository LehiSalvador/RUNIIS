import { createHash, randomBytes, randomUUID } from "node:crypto";
import { psql } from "../support/account";

/**
 * Race day fixtures (P3-H): everything the scanner needs to answer every one of the 11 outcomes, built with direct SQL into the LOCAL
 * Docker database (the credentials are written the way the system issues them, minus the encryption: only the sha256 of the token matters
 * to a scan, so the ciphertext is a placeholder). The plaintext tokens exist only in memory of the test process and in the page's
 * input; they are never written to a file or printed.
 *
 * Each call seeds three fresh Editions (today's check-in window open, another Edition, one far in the future), so parallel viewport
 * projects never share a participant. Nothing is deleted afterwards (the schema forbids deleting registrations): the data lives under a
 * `qa-raceday-<suffix>` slug and `qa-raceday-<suffix>@example.test`.
 */
const MONTERREY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey", year: "numeric", month: "2-digit", day: "2-digit" });
function monterreyDate(days: number): string {
  return MONTERREY.format(new Date(Date.now() + days * 86_400_000));
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}
const hashOf = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const payloadOf = (token: string) => `RN1.${token}`;
const reference = () => `R-${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;

const STAFF_ID = "20000000-0000-4000-8000-000000340001"; // seeded OPERATOR (confirms requests in the seeds)
const EVENT_ID = "40000000-0000-4000-8000-000000340001"; // seeded Event the QA Editions hang from
const PLACEHOLDER_CIPHERTEXT = `decode(repeat('ab', 40), 'hex')`;

export type Seeded = {
  suffix: string;
  editionId: string;
  editionName: string;
  otherEditionId: string;
  futureEditionId: string;
  futureEditionName: string;
  kitMainId: string;
  kitMainName: string;
  kitFutureId: string;
  kitFutureName: string;
  /** QR payloads (RN1.<token>) by role. */
  tokens: Record<string, string>;
  /** A well-formed token no pass owns. */
  unknownToken: string;
  names: Record<string, string>;
  numbers: Record<string, string>;
  passes: Record<string, string>;
  registrations: Record<string, string>;
  /** The code printed on each pass (P-XXXX-NNNN), by role. */
  publicCodes: Record<string, string>;
  /** The legal name the guardian assignment of every seeded minor points at (the buyer's profile). */
  guardianName: string;
};

type Spec = {
  key: string;
  edition: "A" | "B" | "C";
  label: string;
  dob?: string;
  canceled?: boolean;
  credential?: "active" | "revoked" | "replaced";
  guardian?: boolean;
  kit?: { def: "main" | "future"; variant: "M" | "L" } | null;
};

const SPECS: Spec[] = [
  { key: "valid", edition: "A", label: "Valida" },
  { key: "revoked", edition: "A", label: "Revocada", credential: "revoked" },
  { key: "replaced", edition: "A", label: "Reemplazada", credential: "replaced" },
  { key: "canceled", edition: "A", label: "Cancelada", canceled: true },
  { key: "minor", edition: "A", label: "Menor Verifica", dob: "2012-05-04", guardian: true },
  { key: "minorReject", edition: "A", label: "Menor Rechaza", dob: "2012-06-05", guardian: true },
  { key: "minorDesk", edition: "A", label: "Menor Mesa", dob: "2011-03-02", guardian: true },
  { key: "minorDeskReject", edition: "A", label: "Menor Mesa Rechazo", dob: "2011-09-09", guardian: true },
  { key: "manual", edition: "A", label: "Manual Llegada" },
  { key: "manualMinor", edition: "A", label: "Manual Menor", dob: "2012-07-07", guardian: true },
  { key: "other", edition: "B", label: "Otra Edicion" },
  { key: "future", edition: "C", label: "Futura" },
  { key: "kitScan", edition: "A", label: "Kit Escaneo", kit: { def: "main", variant: "M" } },
  { key: "kitManual", edition: "A", label: "Kit Manual", kit: { def: "main", variant: "L" } },
  { key: "kitThird", edition: "A", label: "Kit Tercero", kit: { def: "main", variant: "M" } },
  { key: "kitNone", edition: "A", label: "Kit Ninguno" },
  { key: "kitEarly", edition: "A", label: "Kit Temprano", kit: { def: "future", variant: "M" } },
  { key: "kitUi", edition: "A", label: "Kit Pantalla", kit: { def: "main", variant: "M" } },
  { key: "kitUiThird", edition: "A", label: "Kit Pantalla Tercero", kit: { def: "main", variant: "L" } },
  { key: "kitQr", edition: "A", label: "Kit Cambio QR", kit: { def: "main", variant: "M" } },
  { key: "kitSize", edition: "A", label: "Kit Cambio Talla", kit: { def: "main", variant: "M" } },
  { key: "kitRev", edition: "A", label: "Kit Reversa", kit: { def: "main", variant: "L" } },
  { key: "minorId", edition: "A", label: "Menor Identidad", dob: "2012-08-08", guardian: true },
];

export function seedRaceday(): Seeded {
  const suffix = randomBytes(3).toString("hex");
  // registration_number must match ^I-[0-9A-Z]{4}-[0-9A-Z]{4}$.
  const numberPrefix = randomBytes(2).toString("hex").toUpperCase();
  const ids = {
    buyerAuth: randomUUID(),
    buyer: randomUUID(),
    A: randomUUID(),
    B: randomUUID(),
    C: randomUUID(),
    modA: randomUUID(),
    modB: randomUUID(),
    modC: randomUUID(),
    kitMain: randomUUID(),
    kitFuture: randomUUID(),
    varMainM: randomUUID(),
    varMainL: randomUUID(),
    varFutureM: randomUUID(),
  };
  const editionName = `QA Raceday ${suffix}`;
  const futureEditionName = `QA Raceday Futura ${suffix}`;
  const kitMainName = `Kit Playera ${suffix}`;
  const kitFutureName = `Kit Medalla ${suffix}`;
  // Only the Editions a test must pick in the scanner are published (the public catalogue lists published ones); the "other" Edition stays a draft.
  const edition = (id: string, mod: string, slug: string, name: string, dateOffset: number, sched: string, published = true) => `
    insert into app.edition (edition_id, event_id, slug, name, publication_state, execution_state, registration_state, closure_state,
      registration_mode, timezone, registration_open_at, registration_close_at, city, state_region, country_code, published_at)
    values ('${id}', '${EVENT_ID}', '${slug}', '${name}', '${published ? "PUBLISHED" : "DRAFT"}', 'SCHEDULED', 'OPEN', 'OPEN', 'FREE', 'America/Monterrey',
      now() - interval '5 days', now() + interval '55 days', 'Monterrey', 'NL', 'MX', ${published ? "now()" : "null"});
    insert into app.edition_schedule_revision (edition_schedule_revision_id, edition_id, revision, schedule_state, local_date, local_start_time,
      timezone, effective_start_at, created_by_staff_id)
    values ('${sched}', '${id}', 1, 'DATE_TIME_CONFIRMED', date '${monterreyDate(dateOffset)}', '07:00:00', 'America/Monterrey',
      (date '${monterreyDate(dateOffset)}' + time '07:00:00') at time zone 'America/Monterrey', '${STAFF_ID}');
    insert into app.modality (modality_id, edition_id, key, name, official_distance_m, generates_distance_credit, status, sort_order)
    values ('${mod}', '${id}', '10k', '10K', 10000, true, 'ACTIVE', 1);
    insert into app.modality_capacity (modality_id, effective_capacity) values ('${mod}', 500);`;

  const statements: string[] = [];
  statements.push(`
    insert into auth.users (id, email) values ('${ids.buyerAuth}', 'qa-raceday-${suffix}@example.test');
    insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name, date_of_birth, sex_code, phone_e164,
      emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship, ready_at)
    values ('${ids.buyer}', '${ids.buyerAuth}', 'READY', 'ACTIVE', 'QA Raceday Comprador ${suffix}', '1985-01-01', 'M', '+528110005001',
      'Contacto', '+528110005002', 'Hermano', now());`);
  statements.push(edition(ids.A, ids.modA, `qa-raceday-${suffix}`, editionName, 1, randomUUID()));
  statements.push(edition(ids.B, ids.modB, `qa-raceday-otra-${suffix}`, `QA Raceday Otra ${suffix}`, 1, randomUUID(), false));
  statements.push(edition(ids.C, ids.modC, `qa-raceday-futura-${suffix}`, futureEditionName, 60, randomUUID()));
  statements.push(`
    insert into app.kit_definition (kit_definition_id, edition_id, name, status, instructions) values
      ('${ids.kitMain}', '${ids.A}', '${kitMainName}', 'ACTIVE', 'Entrega con identificación.');
    insert into app.kit_definition (kit_definition_id, edition_id, name, status, pickup_start_at) values
      ('${ids.kitFuture}', '${ids.A}', '${kitFutureName}', 'ACTIVE', now() + interval '10 days');
    insert into app.kit_variant (kit_variant_id, kit_definition_id, variant_key, label, capacity, status) values
      ('${ids.varMainM}', '${ids.kitMain}', 'M', 'Talla M', 40, 'ACTIVE'),
      ('${ids.varMainL}', '${ids.kitMain}', 'L', 'Talla L', 40, 'ACTIVE'),
      ('${ids.varFutureM}', '${ids.kitFuture}', 'M', 'Talla M', 40, 'ACTIVE');`);

  const tokens: Record<string, string> = {};
  const names: Record<string, string> = {};
  const numbers: Record<string, string> = {};
  const passes: Record<string, string> = {};
  const registrations: Record<string, string> = {};
  const publicCodes: Record<string, string> = {};
  const editionOf = { A: ids.A, B: ids.B, C: ids.C };
  const modalityOf = { A: ids.modA, B: ids.modB, C: ids.modC };

  SPECS.forEach((spec, index) => {
    const guest = randomUUID();
    const request = randomUUID();
    const requestParticipant = randomUUID();
    const registration = randomUUID();
    const pass = randomUUID();
    const edId = editionOf[spec.edition];
    const modId = modalityOf[spec.edition];
    const name = `QA ${spec.label} ${suffix}`;
    const number = `I-${numberPrefix}-${String(index + 1).padStart(4, "0")}`;
    names[spec.key] = name;
    numbers[spec.key] = number;
    passes[spec.key] = pass;
    registrations[spec.key] = registration;
    publicCodes[spec.key] = `P-${numberPrefix}-${String(index + 1).padStart(4, "0")}`;
    const dob = spec.dob ?? "1990-01-01";
    statements.push(`
      insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code, phone_e164,
        emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
      values ('${guest}', '${ids.buyer}', '${name}', date '${dob}', 'X', '+528110005003', 'Contacto', '+528110005004', 'Amigo');
      insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, status, registration_mode,
        currency, total_snapshot_minor, confirmed_at, created_at)
      values ('${request}', '${reference()}', '${ids.buyer}', '${edId}', 'CONFIRMED', 'FREE', 'MXN', 0, now() - interval '3 hours', now() - interval '5 hours');
      insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind, guest_participant_id,
        modality_id, price_snapshot_minor, currency, eligibility_snapshot)
      values ('${requestParticipant}', '${request}', 'GUEST', '${guest}', '${modId}', 0, 'MXN', jsonb_build_object('is_minor', ${spec.guardian ? "true" : "false"}));
      insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id, guest_participant_id,
        buyer_profile_id, registration_number, status, confirmed_at, canceled_at, cancel_reason)
      values ('${registration}', '${request}', '${requestParticipant}', '${edId}', '${modId}', '${guest}', '${ids.buyer}', '${number}',
        '${spec.canceled ? "CANCELED" : "CONFIRMED"}', now() - interval '3 hours', ${spec.canceled ? "now()" : "null"}, ${spec.canceled ? "'qa fixture'" : "null"});
      insert into app.participant_pass (participant_pass_id, registration_id, public_code) values ('${pass}', '${registration}', '${publicCodes[spec.key]}');`);

    const token = newToken();
    const credentialId = randomUUID();
    if (spec.credential === "replaced") {
      const next = newToken();
      const nextId = randomUUID();
      tokens[`${spec.key}Old`] = payloadOf(token);
      tokens[spec.key] = payloadOf(next);
      statements.push(`
        insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash, token_ciphertext, encryption_key_version, status, replaced_at)
        values ('${credentialId}', '${pass}', 1, '${hashOf(token)}', ${PLACEHOLDER_CIPHERTEXT}, 1, 'REPLACED', now() - interval '1 hour');
        insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash, token_ciphertext, encryption_key_version, status)
        values ('${nextId}', '${pass}', 2, '${hashOf(next)}', ${PLACEHOLDER_CIPHERTEXT}, 1, 'ACTIVE');
        update app.participant_pass set current_credential_id = '${nextId}' where participant_pass_id = '${pass}';`);
    } else if (spec.credential === "revoked") {
      tokens[spec.key] = payloadOf(token);
      statements.push(`
        insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash, token_ciphertext, encryption_key_version, status, revoked_at)
        values ('${credentialId}', '${pass}', 1, '${hashOf(token)}', ${PLACEHOLDER_CIPHERTEXT}, 1, 'REVOKED', now() - interval '1 hour');`);
    } else {
      tokens[spec.key] = payloadOf(token);
      statements.push(`
        insert into app.participant_pass_credential (participant_pass_credential_id, participant_pass_id, version, token_hash, token_ciphertext, encryption_key_version, status)
        values ('${credentialId}', '${pass}', 1, '${hashOf(token)}', ${PLACEHOLDER_CIPHERTEXT}, 1, 'ACTIVE');
        update app.participant_pass set current_credential_id = '${credentialId}' where participant_pass_id = '${pass}';`);
    }

    if (spec.guardian) {
      statements.push(`
        insert into app.guardian_assignment (minor_guest_participant_id, guardian_profile_id, relationship_type, status, activated_at)
        values ('${guest}', '${ids.buyer}', 'PARENT', 'ACTIVE', now() - interval '1 day');`);
    }
    if (spec.kit) {
      const def = spec.kit.def === "main" ? ids.kitMain : ids.kitFuture;
      const variant = spec.kit.def === "future" ? ids.varFutureM : spec.kit.variant === "M" ? ids.varMainM : ids.varMainL;
      statements.push(`
        insert into app.kit_allocation (registration_id, kit_definition_id, kit_variant_id, status, assigned_at)
        values ('${registration}', '${def}', '${variant}', 'ASSIGNED', now());`);
    }
  });

  psql(statements.join("\n"));

  return {
    suffix,
    editionId: ids.A,
    editionName,
    otherEditionId: ids.B,
    futureEditionId: ids.C,
    futureEditionName,
    kitMainId: ids.kitMain,
    kitMainName,
    kitFutureId: ids.kitFuture,
    kitFutureName,
    tokens,
    unknownToken: payloadOf(newToken()),
    names,
    numbers,
    passes,
    registrations,
    publicCodes,
    guardianName: `QA Raceday Comprador ${suffix}`,
  };
}
