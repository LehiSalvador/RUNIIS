import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localAnonClient, localSystemClient } from "../supabase";

const DB_CONTAINER = "supabase_db_RUNIIIS_WEB";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54624";
export const APP_URL = process.env.APP_BASE_URL ?? "http://127.0.0.1:3100";

/**
 * Minimal cookie jar for HTTP-level auth flow tests against the shared dev server: Node's fetch
 * does not persist Set-Cookie across calls the way a browser does, and the HttpOnly session
 * cookies (SEC-049) are exactly what these tests need to carry from /auth/verify to later calls.
 */
export function createCookieJar() {
  const jar = new Map<string, string>();
  return {
    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
      const headers = new Headers(init.headers);
      if (jar.size > 0) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
      const response = await fetch(new URL(path, APP_URL), { ...init, headers, redirect: "manual" });
      for (const setCookie of response.headers.getSetCookie?.() ?? []) {
        const [pair] = setCookie.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      return response;
    },
    clear(): void {
      jar.clear();
    },
  };
}

/**
 * Shared fixtures for every task's integration tests (T20 owns this location; domain-specific
 * fixtures live under their own tests/integration/<module>/helpers.ts and may build on these).
 * Everything here targets the local Docker stack only (ADR-001 owner environment model);
 * synthetic identities only (`t20-*@example.test`).
 */

/** Direct SQL against the local Postgres container: fixture setup needs app/private, never exposed over the API. */
export function sql(text: string): void {
  const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: text,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`fixture SQL failed (exit ${result.status}): ${result.stderr || result.stdout}`);
}

/** Same as `sql`, but returns a single scalar column (`-t -A`) for assertions PostgREST can't give. */
export function queryValue(text: string): string | null {
  const result = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-q"],
    { input: text, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`fixture query failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

/** Secret-key client for fixture setup/teardown and admin-only reads (local target only). */
export function systemClient(): SupabaseClient {
  return localSystemClient();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Integration tests need ${name} (.env.development.local)`);
  return value;
}

/**
 * Signs in for real via admin.generateLink -> verifyOtp (no email UI needed; works for a brand new
 * email too -- GoTrue creates the user as a side effect of the link, same as a real OTP sign-up).
 * Returns both the new/existing auth_user_id and a session-bound client (real JWT).
 */
export async function sessionClientFor(email: string): Promise<{ authUserId: string; client: SupabaseClient }> {
  const system = systemClient();
  const { data, error } = await system.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.user) throw new Error(`generateLink failed for ${email}: ${error?.message}`);

  const anon = localAnonClient();
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "email" });
  if (verifyError || !verified.session) throw new Error(`verifyOtp failed for ${email}: ${verifyError?.message}`);

  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: setSessionError } = await client.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (setSessionError) throw new Error(`setSession failed for ${email}: ${setSessionError.message}`);
  return { authUserId: data.user.id, client };
}

export type TestUser = {
  authUserId: string;
  email: string;
  runnerProfileId: string | null;
  publicProfileId: string | null;
  client: SupabaseClient;
};

/**
 * Real auth.users row (admin API) plus a real signed-in session (no shortcuts: every RPC the
 * returned client calls runs under real RLS / auth.uid()). `ready: true` (default) also inserts a
 * READY + ACTIVE app.runner_profile (+ community_profile); `ready: false` leaves no profile row,
 * matching a freshly-verified sign-in before onboarding.
 */
export async function createTestUser(
  options: {
    label?: string;
    ready?: boolean;
    dob?: string;
    sexCode?: "F" | "M" | "X";
    accountState?: "ACTIVE" | "IDENTITY_LOCKED" | "BANNED" | "DEACTIVATED";
  } = {},
): Promise<TestUser> {
  const label = options.label ?? "user";
  const email = `t20-${label}-${randomUUID()}@example.test`;
  const { authUserId, client } = await sessionClientFor(email);

  let runnerProfileId: string | null = null;
  let publicProfileId: string | null = null;
  if (options.ready ?? true) {
    runnerProfileId = randomUUID();
    publicProfileId = randomUUID();
    const dob = options.dob ?? "1990-01-01";
    const sexCode = options.sexCode ?? "F";
    const accountState = options.accountState ?? "ACTIVE";
    sql(`
      insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
        date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
        emergency_contact_relationship, ready_at)
      values ('${runnerProfileId}', '${authUserId}', 'READY', '${accountState}', 'Persona ${label}',
        '${dob}', '${sexCode}', '+528110000900', 'Contacto Emergencia', '+528110000901', 'Madre', now());
      insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible, is_searchable)
      values ('${runnerProfileId}', '${publicProfileId}', 'ELIGIBLE', true, true);
    `);
  }

  return { authUserId, email, runnerProfileId, publicProfileId, client };
}

export type TestStaff = TestUser & { staffMemberId: string };

/** A staff_member with one ACTIVE role assignment, plus a real signed-in session for them. */
export async function createTestStaff(
  role: "ADMIN" | "OPERATOR" | "CHECKIN" | "MODERATOR",
  scopeType: "GLOBAL" | "EDITION",
  editionId: string | null = null,
): Promise<TestStaff> {
  const user = await createTestUser({ label: `staff-${role.toLowerCase()}`, ready: false });
  const staffMemberId = randomUUID();
  const editionLiteral = editionId ? `'${editionId}'` : "null";
  sql(`
    insert into app.staff_member (staff_member_id, auth_user_id, status) values ('${staffMemberId}', '${user.authUserId}', 'ACTIVE');
    insert into app.staff_role_assignment (staff_member_id, role, scope_type, edition_id)
    values ('${staffMemberId}', '${role}', '${scopeType}', ${editionLiteral});
  `);
  return { ...user, staffMemberId };
}

/** Fetches the most recent OTP code Mailpit received for `email` (local dev only, SEC-040 flow). */
export async function fetchOtpCode(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const search = new URL("/api/v1/search", MAILPIT_URL);
    search.searchParams.set("query", `to:${email}`);
    const response = await fetch(search);
    const body = (await response.json()) as { messages: { ID: string }[] };
    if (body.messages.length > 0) {
      const detail = await fetch(new URL(`/api/v1/message/${body.messages[0].ID}`, MAILPIT_URL));
      const message = (await detail.json()) as { Text: string };
      const match = message.Text.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    if (Date.now() > deadline) throw new Error(`No OTP email reached Mailpit for ${email} within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Drives the real HTTP flow (POST /api/v1/auth/otp -> Mailpit -> POST /api/v1/auth/verify) against
 * the shared dev server, leaving `jar` holding real HttpOnly session cookies. Returns the
 * auth_user_id (looked up by email) so callers can register it with `cleanup`.
 */
export async function httpSignIn(jar: ReturnType<typeof createCookieJar>, email: string): Promise<string> {
  const otpResponse = await jar.fetch("/api/v1/auth/otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (otpResponse.status !== 202) throw new Error(`OTP request failed for ${email}: ${otpResponse.status}`);

  const code = await fetchOtpCode(email);
  const verifyResponse = await jar.fetch("/api/v1/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (verifyResponse.status !== 200) throw new Error(`verify failed for ${email}: ${verifyResponse.status}`);

  const authUserId = queryValue(`select id::text from auth.users where email = '${email}'`);
  if (!authUserId) throw new Error(`no auth.users row found for ${email} after verify`);
  return authUserId;
}

/** Best-effort teardown: deletes auth users created by this test file (cascades to their app rows). */
export async function cleanup(authUserIds: readonly string[]): Promise<void> {
  const system = systemClient();
  await Promise.all(authUserIds.map((id) => system.auth.admin.deleteUser(id).catch(() => undefined)));
}
