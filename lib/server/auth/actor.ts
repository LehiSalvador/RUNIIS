import "server-only";
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError } from "../http/errors";
import { callRpc } from "../rpc";

export const STAFF_ROLES = ["ADMIN", "OPERATOR", "CHECKIN", "MODERATOR"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

// Contract of `public.current_actor()` (owned by the auth/RLS task).
export const actorSchema = z.object({
  auth_user_id: z.uuid().nullable(),
  runner_profile_id: z.uuid().nullable(),
  profile_readiness: z.enum(["PROFILE_INCOMPLETE", "READY"]).nullable(),
  account_state: z.enum(["ACTIVE", "IDENTITY_LOCKED", "BANNED", "DEACTIVATED"]).nullable(),
  staff_member_id: z.uuid().nullable(),
  staff_roles: z.array(
    z.object({
      role: z.enum(STAFF_ROLES),
      scope_type: z.enum(["GLOBAL", "EDITION"]),
      edition_id: z.uuid().nullable(),
    }),
  ),
});

export type Actor = z.output<typeof actorSchema>;

export const ANONYMOUS_ACTOR: Actor = {
  auth_user_id: null,
  runner_profile_id: null,
  profile_readiness: null,
  account_state: null,
  staff_member_id: null,
  staff_roles: [],
};

/**
 * Verifies the session JWT (refreshing it through the cookie client when needed) and loads the
 * actor projection. The actor is only used for early rejects; DB commands re-authorise.
 */
export async function resolveActor(supabase: SupabaseClient): Promise<Actor> {
  const { data, error } = await supabase.auth.getClaims();
  if (error && isAuthRetryableFetchError(error)) throw new AppError("DEPENDENCY_UNAVAILABLE");
  if (error || !data?.claims.sub) return ANONYMOUS_ACTOR;
  return callRpc(supabase, "current_actor", {}, actorSchema);
}
