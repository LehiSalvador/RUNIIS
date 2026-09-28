import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getServerEnv } from "../env";

export const SUPABASE_REQUEST_TIMEOUT_MS = 10_000;

// Bounds every Supabase HTTP call so a stalled dependency surfaces as DEPENDENCY_UNAVAILABLE
// instead of hanging the request.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

const statelessAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/**
 * Caller-context client bound to the Next cookie store, so `auth.uid()` in Postgres is the real
 * user. For route handlers, server components and server actions. Session refresh middleware
 * and sign-in flows live in the auth module.
 */
export async function createSessionClient(): Promise<SupabaseClient> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: fetchWithTimeout },
    // SEC-049: the library default is httpOnly:false; session cookies must never be JS-readable.
    cookieOptions: { httpOnly: true, secure: env.APP_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server components cannot write cookies; the auth proxy refreshes the session there.
        }
      },
    },
  });
}

let anonClient: SupabaseClient | undefined;

/** Publishable-key client with no session, for public reads that anon RLS allows. */
export function createAnonClient(): SupabaseClient {
  const env = getServerEnv();
  anonClient ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: statelessAuth,
    global: { fetch: fetchWithTimeout },
  });
  return anonClient;
}

let systemClient: SupabaseClient | undefined;

/** Secret-key client that bypasses RLS. Workers, webhooks and provider callbacks only (ADR-001 §6). */
export function createSystemClient(): SupabaseClient {
  const env = getServerEnv();
  systemClient ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: statelessAuth,
    global: { fetch: fetchWithTimeout },
  });
  return systemClient;
}
