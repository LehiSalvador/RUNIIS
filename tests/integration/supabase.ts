import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const statelessAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Integration tests need ${name} (.env.development.local)`);
  return value;
}

/** Publishable-key client against local Supabase (target verified by setup.ts). */
export function localAnonClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), { auth: statelessAuth });
}

/** Secret-key client for fixture setup/teardown in local Supabase only. */
export function localSystemClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), { auth: statelessAuth });
}
