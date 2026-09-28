import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localAnonClient, localSystemClient } from "../supabase";

const DB_CONTAINER = "supabase_db_RUNIIIS_WEB";

/**
 * Direct SQL against the local Postgres container (docker exec, not PostgREST): fixture setup
 * needs the `app`/`private` schemas, which are never exposed over the API (supabase/config.toml
 * `api.schemas`). Mirrors supabase/tests/database fixtures. Bypasses `scripts/db.mjs`'s cross-
 * process lock deliberately: `sql` there is unlocked too, and `test:integration` already holds
 * the lock for the whole vitest run (locking here would self-deadlock).
 */
export function sql(text: string): void {
  const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: text,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`fixture SQL failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
}

/** Same as `sql`, but returns a single scalar column (`-t -A`) for assertions fixtures can't get via PostgREST. */
export function queryValue(text: string): string | null {
  const result = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-q"],
    { input: text, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`fixture query failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

export type TestProfile = {
  authUserId: string;
  runnerProfileId: string;
  publicProfileId: string;
  /** Session-bound client (real JWT via OTP sign-in): every RPC runs under real RLS/auth.uid(). */
  client: SupabaseClient;
};

/**
 * A READY + ACTIVE, visible + searchable adult profile with a real session, established the only
 * way this app allows (SEC-040: OTP/Google only, no password credential ever exists). Uses the
 * admin API to generate a magic-link token, then redeems it on an anon client — no email/Mailpit
 * round trip needed.
 */
export async function createReadyProfile(label: string): Promise<TestProfile> {
  const email = `t33-${label}-${randomUUID()}@example.test`;
  const system = localSystemClient();
  const { data, error } = await system.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.user) throw new Error(`generateLink failed for ${label}: ${error?.message}`);
  const authUserId = data.user.id;

  const anon = localAnonClient();
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "email",
  });
  if (verifyError || !verified.session) throw new Error(`verifyOtp failed for ${label}: ${verifyError?.message}`);

  const runnerProfileId = randomUUID();
  const publicProfileId = randomUUID();
  sql(`
    insert into app.runner_profile (runner_profile_id, auth_user_id, profile_readiness, account_state, full_name,
      date_of_birth, sex_code, phone_e164, emergency_contact_name, emergency_contact_phone_e164,
      emergency_contact_relationship, ready_at)
    values ('${runnerProfileId}', '${authUserId}', 'READY', 'ACTIVE', 'Perfil ${label}',
      '1990-01-01', 'F', '+528110000900', 'Contacto Emergencia', '+528110000901', 'Madre', now());
    insert into app.community_profile (runner_profile_id, public_profile_id, competition_status, is_visible, is_searchable)
    values ('${runnerProfileId}', '${publicProfileId}', 'ELIGIBLE', true, true);
  `);

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: setSessionError } = await client.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (setSessionError) throw new Error(`setSession failed for ${label}: ${setSessionError.message}`);

  return { authUserId, runnerProfileId, publicProfileId, client };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Integration tests need ${name} (.env.development.local)`);
  return value;
}
