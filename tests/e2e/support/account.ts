import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { e2eEnv } from "./env";
import { verifyWaitMessage, verifyWaitSeconds, VERIFY_RETRIES } from "./rate-limit";
import { adminOtpFor, fixtureEmailFor } from "./remote-auth";
import { safeApi } from "./safe-request";

/**
 * F2 account e2e fixtures: real local auth only (POST /auth/otp -> Mailpit -> POST /auth/verify, the
 * same HttpOnly cookies a browser gets), synthetic `f2-*@example.test` identities, and direct SQL
 * against the local Docker DB for state the UI cannot create (registration requests, passes,
 * account sanctions). Never targets anything but 127.0.0.1.
 */
const envFile = ".env.development.local";
if (existsSync(envFile)) process.loadEnvFile(envFile);

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54624";
const DB_CONTAINER = "supabase_db_RUNIIIS_WEB";

/** Seeded EXTERNAL_WHATSAPP Edition + Modality (supabase/seeds/40_registrations.sql). */
export const SEED_EDITION = {
  editionId: "50000000-0000-4000-8000-000000340001",
  modalityId: "60000000-0000-4000-8000-000000340001",
  name: "Seed Carrera Registro 2026",
} as const;

/** Skip reason for specs that seed state through the local Docker DB. */
export const LOCAL_DB_ONLY = "needs the local Docker DB (SQL-seeded fixtures); not available against a remote target";

/** Runs the fixture SQL in one transaction (all or nothing). Local Docker DB only. */
export function psql(text: string): string {
  if (!e2eEnv().localDb) throw new Error(LOCAL_DB_ONLY);
  const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], {
    input: `begin;\n${text};\ncommit;`,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`fixture SQL failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export function uniqueEmail(label: string): string {
  if (e2eEnv().adminOtp) return fixtureEmailFor(label);
  return `f2-${label}-${randomUUID().slice(0, 12)}@example.test`;
}

/** True when sign-in uses the admin OTP path (no mailbox involved). */
export function usesAdminOtp(): boolean {
  return e2eEnv().adminOtp !== null;
}

/**
 * Local dev keys every anonymous rate limit on one "local-dev" subject (lib/server/http/client-ip.ts),
 * so parallel specs would share the per-IP OTP budget. Clearing only the IP-scoped auth buckets keeps
 * the per-email limits (the behaviour under test) intact.
 */
export function resetAuthIpBuckets(): void {
  if (!e2eEnv().localDb) return; // remote targets rate-limit by real client IP; nothing to reset
  psql("delete from infra.rate_limit_counter where scope in ('auth.otp.ip', 'auth.verify.ip');");
}

export async function fetchOtpCode(email: string, timeoutMs = 45_000): Promise<string> {
  if (usesAdminOtp()) return adminOtpFor(email);
  if (!e2eEnv().localDb) throw new Error("Remote sign-in needs E2E_SUPABASE_URL and E2E_SUPABASE_SERVER_KEY (no mailbox is readable there)");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const search = new URL("/api/v1/search", MAILPIT_URL);
    search.searchParams.set("query", `to:"${email}"`);
    const response = await fetch(search);
    const body = (await response.json()) as { messages: { ID: string }[] };
    if (body.messages.length > 0) {
      const detail = await fetch(new URL(`/api/v1/message/${body.messages[0].ID}`, MAILPIT_URL));
      const message = (await detail.json()) as { Text: string };
      const match = message.Text.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    if (Date.now() > deadline) throw new Error(`No OTP email for ${email}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/**
 * Real OTP sign-in through the app API; the page's browser context receives the session cookies.
 * Admin-OTP mode skips POST /auth/otp (no email is sent) and verifies the generated code directly;
 * a 429 on verify (auth.verify.ip: 30 per 10 min per client IP) is waited out a few times.
 */
export async function signInViaApi(rawRequest: APIRequestContext, email: string): Promise<void> {
  // safeApi: a transport failure reports method + path + reason, never Playwright's header-laden call log (H2P2-04).
  const request = safeApi(rawRequest);
  resetAuthIpBuckets();
  if (!usesAdminOtp()) {
    const otp = await request.post("/api/v1/auth/otp", { data: { email } });
    expect(otp.status(), "OTP request").toBe(202);
  }
  const code = await fetchOtpCode(email);
  const origin = new URL(e2eEnv().baseURL).origin;
  let verify = await request.post("/api/v1/auth/verify", { data: { email, code }, headers: { Origin: origin } });
  for (let attempt = 0; attempt < VERIFY_RETRIES && verify.status() === 429 && !e2eEnv().localDb; attempt++) {
    const waitSeconds = verifyWaitSeconds(verify.headers()["retry-after"]);
    console.log(verifyWaitMessage("api", waitSeconds, attempt + 1));
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    verify = await request.post("/api/v1/auth/verify", { data: { email, code }, headers: { Origin: origin } });
  }
  expect(verify.status(), "OTP verify").toBe(200);
}

export type PersonInput = {
  full_name: string;
  date_of_birth: string;
  sex_code: "F" | "M" | "X";
  phone_e164: string;
  emergency_contact_name: string;
  emergency_contact_phone_e164: string;
  emergency_contact_relationship: string;
};

export function adultPerson(name: string): PersonInput {
  return {
    full_name: name,
    date_of_birth: "1991-03-14",
    sex_code: "F",
    phone_e164: "+528110001234",
    emergency_contact_name: "Contacto Sintético",
    emergency_contact_phone_e164: "+528110005678",
    emergency_contact_relationship: "Madre",
  };
}

/** ISO date for someone who turns `years` old `daysAgo` days ago (business-day safe margin). */
export function birthDateForAge(years: number, daysAgo = 30): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export type AccountUser = { email: string; runnerProfileId: string; publicProfileId: string; name: string };

export async function readMe(rawRequest: APIRequestContext) {
  const response = await safeApi(rawRequest).get("/api/v1/me");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: { runner_profile_id: string; community: { public_profile_id: string } | null } }).data;
}

/**
 * The current TERMS_OF_SERVICE / PRIVACY_NOTICE version ids of the target (GET /me/legal). Onboarding records the
 * acceptance of exactly these (P2-G5 requires them; sending them is valid before and after it).
 */
export async function currentLegalVersionIds(rawRequest: APIRequestContext): Promise<string[]> {
  const response = await safeApi(rawRequest).get("/api/v1/me/legal");
  expect(response.status(), "legal status").toBe(200);
  const body = (await response.json()) as { data: { documents: { legal_document_version_id: string }[] } };
  return body.data.documents.map((document) => document.legal_document_version_id);
}

/** POST /me/onboarding for `person`, always sending the current account-level legal versions ([] only when none is published). */
export async function postOnboarding(rawRequest: APIRequestContext, person: PersonInput): Promise<APIResponse> {
  const ids = await currentLegalVersionIds(rawRequest);
  return safeApi(rawRequest).post("/api/v1/me/onboarding", { data: { ...person, legal_document_version_ids: ids } });
}

/** Signed-in, READY account (onboarding done through the real API). */
export async function createReadyUser(page: Page, label: string, person?: Partial<PersonInput>): Promise<AccountUser> {
  const email = uniqueEmail(label);
  await signInViaApi(page.request, email);
  const name = person?.full_name ?? `Persona ${label} ${randomUUID().slice(0, 4)}`;
  const onboarding = await postOnboarding(page.request, { ...adultPerson(name), ...person, full_name: name });
  expect(onboarding.status(), "onboarding").toBe(200);
  const me = await readMe(page.request);
  return { email, runnerProfileId: me.runner_profile_id, publicProfileId: me.community!.public_profile_id, name };
}

const chunk = () => randomBytes(2).toString("hex").toUpperCase();

/** Matches the DB format checks (R-/I-/P- + two 4-char [0-9A-Z] groups). */
function publicReference(): string {
  return `R-${chunk()}-${chunk()}`;
}

/** PENDING_CONFIRMATION request (EXTERNAL_WHATSAPP) held by `runnerProfileId`, expiring in `minutes`. */
export function seedPendingRequest(runnerProfileId: string, minutes = 90): { requestId: string; reference: string } {
  const requestId = randomUUID();
  const participantId = randomUUID();
  const reference = publicReference();
  psql(`
    insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id,
      registration_mode, currency, total_snapshot_minor, whatsapp_phone_snapshot, expires_at, created_at)
    values ('${requestId}', '${reference}', '${runnerProfileId}', '${SEED_EDITION.editionId}', 'EXTERNAL_WHATSAPP', 'MXN', 35000,
      '+528110000099', now() + interval '${minutes} minutes', now());
    insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
      runner_profile_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot, created_at)
    values ('${participantId}', '${requestId}', 'PROFILE', '${runnerProfileId}', '${SEED_EDITION.modalityId}', 35000, 'MXN',
      jsonb_build_object('is_minor', false), now());
    insert into app.registration_hold (registration_request_id, modality_id, quantity, expires_at)
    values ('${requestId}', '${SEED_EDITION.modalityId}', 1, now() + interval '${minutes} minutes');
    insert into app.registration_participant_claim (edition_id, registration_request_id, request_participant_id, runner_profile_id, expires_at)
    values ('${SEED_EDITION.editionId}', '${requestId}', '${participantId}', '${runnerProfileId}', now() + interval '${minutes} minutes');
  `);
  return { requestId, reference };
}

/** CONFIRMED request with the buyer's own pass and a Guest pass (held by the buyer). */
export function seedConfirmedWithPasses(runnerProfileId: string, guestName: string): { requestId: string; ownCode: string; guestCode: string } {
  const requestId = randomUUID();
  const guestId = randomUUID();
  const selfParticipant = randomUUID();
  const guestParticipant = randomUUID();
  const selfRegistration = randomUUID();
  const guestRegistration = randomUUID();
  const suffix = chunk();
  const ownCode = `P-${suffix}-${chunk()}`;
  const guestCode = `P-${suffix}-${chunk()}`;
  psql(`
    insert into app.guest_participant (guest_participant_id, owner_profile_id, full_name, date_of_birth, sex_code,
      phone_e164, emergency_contact_name, emergency_contact_phone_e164, emergency_contact_relationship)
    values ('${guestId}', '${runnerProfileId}', '${guestName}', '1994-05-05', 'M', '+528110007001', 'Contacto', '+528110007002', 'Amistad');
    insert into app.registration_request (registration_request_id, public_reference, buyer_profile_id, edition_id, status,
      registration_mode, currency, total_snapshot_minor, whatsapp_phone_snapshot, expires_at, confirmed_at, created_at)
    values ('${requestId}', '${publicReference()}', '${runnerProfileId}', '${SEED_EDITION.editionId}', 'CONFIRMED', 'EXTERNAL_WHATSAPP',
      'MXN', 70000, '+528110000099', now() - interval '1 hour', now() - interval '30 minutes', now() - interval '2 hours');
    insert into app.registration_request_participant (request_participant_id, registration_request_id, participant_kind,
      runner_profile_id, guest_participant_id, modality_id, price_snapshot_minor, currency, eligibility_snapshot, created_at)
    values
      ('${selfParticipant}', '${requestId}', 'PROFILE', '${runnerProfileId}', null, '${SEED_EDITION.modalityId}', 35000, 'MXN', jsonb_build_object('is_minor', false), now() - interval '2 hours'),
      ('${guestParticipant}', '${requestId}', 'GUEST', null, '${guestId}', '${SEED_EDITION.modalityId}', 35000, 'MXN', jsonb_build_object('is_minor', false), now() - interval '2 hours' + interval '1 millisecond');
    insert into app.registration_confirmation (registration_request_id, confirmation_method, confirmed_by_staff_id)
    values ('${requestId}', 'EXTERNAL_WHATSAPP', '20000000-0000-4000-8000-000000340001');
    insert into app.registration (registration_id, registration_request_id, request_participant_id, edition_id, modality_id,
      runner_profile_id, guest_participant_id, buyer_profile_id, registration_number, confirmed_at)
    values
      ('${selfRegistration}', '${requestId}', '${selfParticipant}', '${SEED_EDITION.editionId}', '${SEED_EDITION.modalityId}', '${runnerProfileId}', null, '${runnerProfileId}', 'I-${suffix}-${chunk()}', now() - interval '30 minutes'),
      ('${guestRegistration}', '${requestId}', '${guestParticipant}', '${SEED_EDITION.editionId}', '${SEED_EDITION.modalityId}', null, '${guestId}', '${runnerProfileId}', 'I-${suffix}-${chunk()}', now() - interval '30 minutes');
    insert into app.participant_pass (participant_pass_id, registration_id, public_code)
    values (gen_random_uuid(), '${selfRegistration}', '${ownCode}'), (gen_random_uuid(), '${guestRegistration}', '${guestCode}');
  `);
  return { requestId, ownCode, guestCode };
}

export function setAccountState(runnerProfileId: string, state: "ACTIVE" | "IDENTITY_LOCKED" | "BANNED" | "DEACTIVATED"): void {
  psql(`update app.runner_profile set account_state = '${state}' where runner_profile_id = '${runnerProfileId}';`);
}
