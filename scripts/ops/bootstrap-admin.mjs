#!/usr/bin/env node
// One-shot first-admin bootstrap (ADR-001 A7/§6, Master §144-145, SEC-021). Grants GLOBAL ADMIN to
// an existing account by email, but only when no ACTIVE GLOBAL ADMIN exists yet; every later grant
// goes through POST /api/v1/admin/staff (an existing ADMIN, never this script).
//
// Reads Supabase URL/secret key from the environment this script runs in -- never from a literal or
// a committed file. Run via SalvaOps/the orchestrator, not by pasting a secret into a prompt:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/ops/bootstrap-admin.mjs <email>

import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node scripts/ops/bootstrap-admin.mjs <email>");
    process.exit(1);
  }

  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.rpc("bootstrap_first_admin", { p_email: email });
  if (error) {
    console.error(`bootstrap_first_admin failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`Granted GLOBAL ADMIN to ${email}: ${JSON.stringify(data)}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
