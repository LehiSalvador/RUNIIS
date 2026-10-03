import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { e2eEnv } from "./env";

/**
 * Sign-in without UI email for remote targets (and for a local rehearsal of them): with the target's
 * Supabase URL + server key injected through the environment, an OTP is generated server-side
 * (auth.admin.generateLink -> properties.email_otp) and then verified through the app's own
 * /api/v1/auth/verify, so the browser/API context receives the same HttpOnly session cookies a real
 * sign-in yields. No email is sent and no secret is ever written anywhere.
 *
 * Fixture users are synthetic (qa.e2e.<run>-<label>-<rand>@example.com). Every user created is
 * appended to the fixture log (id + email + target host, never a key) and echoed once to stdout, so a
 * run's footprint is fully enumerable. Nothing else on the target is touched.
 */
let admin: SupabaseClient | null = null;

function adminClient(): SupabaseClient {
  const config = e2eEnv().adminOtp;
  if (!config) throw new Error("Admin OTP sign-in needs E2E_SUPABASE_URL and E2E_SUPABASE_SERVER_KEY");
  admin ??= createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return admin;
}

/** Harness self-tests only. */
export function resetAdminClientCache(): void {
  admin = null;
}

export function fixtureEmailFor(label: string): string {
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "user";
  return `qa.e2e.${e2eEnv().runId}-${safe}-${randomUUID().slice(0, 6)}@example.com`;
}

function recordFixture(entry: { email: string; auth_user_id: string; created: true }): void {
  const e2e = e2eEnv();
  const line = JSON.stringify({ at: new Date().toISOString(), run_id: e2e.runId, target: new URL(e2e.baseURL).host, kind: "auth_user", ...entry });
  try {
    mkdirSync(dirname(e2e.fixtureLog), { recursive: true });
    appendFileSync(e2e.fixtureLog, `${line}\n`);
  } catch {
    // The stdout echo below is the fallback record; never fail a test over bookkeeping.
  }
  console.log(`[e2e-fixture] ${line}`);
}

/** Creates the QA user if it does not exist (idempotent) and returns a fresh 6-digit OTP for it. */
export async function adminOtpFor(email: string): Promise<string> {
  if (!/^qa\.e2e\.[a-z0-9.-]+@example\.com$/.test(email)) {
    throw new Error("Refusing to generate an OTP for an address outside the qa.e2e.*@example.com fixture pattern");
  }
  const client = adminClient();
  const created = await client.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    throw new Error(`fixture user create failed: ${created.error.message}`);
  }
  if (created.data.user) recordFixture({ email, auth_user_id: created.data.user.id, created: true });
  const link = await client.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.properties?.email_otp) throw new Error(`admin OTP generation failed: ${link.error?.message ?? "no email_otp"}`);
  return link.data.properties.email_otp;
}
