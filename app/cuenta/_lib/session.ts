import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { resolveActor } from "@/lib/server/auth/actor";
import type { myProfileSchema } from "@/lib/server/domain/auth/contracts";
import { ensureRunnerProfile } from "@/lib/server/domain/auth/service";
import { AppError, toAppError, type ErrorCode } from "@/lib/server/http/errors";
import { createSessionClient } from "@/lib/server/supabase/clients";

export type MyProfile = z.output<typeof myProfileSchema>;
export type AccountRestriction = "IDENTITY_LOCKED" | "BANNED" | "DEACTIVATED";

export type AccountContext =
  | { restriction: null; supabase: SupabaseClient; profile: MyProfile }
  | { restriction: AccountRestriction; supabase: SupabaseClient; profile: MyProfile | null };

/**
 * Server-side page guard for every signed-in surface. It is only an early redirect: each API route
 * and DB command re-authorises on its own. No session -> /entrar?next=<this page>. The profile row is
 * ensured (idempotent) so a fresh sign-in always has something to onboard; a blocked identity or a
 * non-ACTIVE account resolves to a restriction the page renders instead of its content.
 */
export async function loadAccount(currentPath: string): Promise<AccountContext> {
  const supabase = await createSessionClient();
  const actor = await resolveActor(supabase);
  if (!actor.auth_user_id) redirect(`/entrar?next=${encodeURIComponent(currentPath)}`);

  let profile: MyProfile;
  try {
    profile = await ensureRunnerProfile(supabase);
  } catch (error) {
    if (error instanceof AppError && error.code === "IDENTITY_LOCKED") return { restriction: "IDENTITY_LOCKED", supabase, profile: null };
    throw error;
  }
  if (profile.account_state !== "ACTIVE") return { restriction: profile.account_state, supabase, profile };
  return { restriction: null, supabase, profile };
}

/** loadAccount + PROFILE_INCOMPLETE -> /onboarding (restricted accounts are shown their state instead). */
export async function requireReadyAccount(currentPath: string): Promise<AccountContext> {
  const account = await loadAccount(currentPath);
  if (!account.restriction && account.profile.profile_readiness !== "READY") {
    redirect(`/onboarding?next=${encodeURIComponent(currentPath)}`);
  }
  return account;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; code: ErrorCode };

/** Per-section loading: one failing read renders that section's error state, never the whole page. */
export async function settle<T>(promise: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await promise };
  } catch (error) {
    return { ok: false, code: toAppError(error, { surface: "account_page" }).code };
  }
}
