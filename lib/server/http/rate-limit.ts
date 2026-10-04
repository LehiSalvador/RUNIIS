import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { callRpc } from "../rpc";
import { createSystemClient } from "../supabase/clients";

const rateLimitResultSchema = z.object({ allowed: z.literal(true) });

/**
 * SUPPLIED-subject rate limit pre-check for infra endpoints that are not owned by a specific
 * domain (e.g. F7's CSP report sink). Route handlers never call the system client directly
 * (SEC-007); this is the thin domain-agnostic wrapper for that rule. Throws RATE_LIMITED
 * (AppError) when the scope's policy is exceeded.
 */
export function consumeInfraRateLimit(scope: string, subject: string): Promise<{ allowed: true }> {
  return callRpc(createSystemClient(), "consume_subject_rate_limit", { p_scope: scope, p_subject: subject }, rateLimitResultSchema);
}

/** infra.rate_limit_policy scope of the staff mutation pre-check (SEC-141, Master §179: 120 per 60 s per staff actor). */
export const STAFF_MUTATION_RATE_LIMIT_SCOPE = "admin.mutation";

const actorRateLimitResultSchema = z.object({ allowed: z.literal(true) });

/**
 * ACTOR rate-limit PRE-CHECK for staff mutations (P3SECA-03, SEC-141). It runs through the caller's own session in its OWN
 * transaction (consume_actor_rate_limit), so failed attempts (validation, FORBIDDEN, conflicts) count too; the
 * `admin.mutation:cmd` bucket inside the commands only counts commands that succeeded. `defineRoute` applies it to every
 * non-GET/HEAD staff route unless the route opts out with `actorRateLimit: false` (race-day check-in keeps its own limits).
 * Throws RATE_LIMITED (AppError).
 */
export async function consumeStaffMutationRateLimit(supabase: SupabaseClient): Promise<void> {
  await callRpc(supabase, "consume_actor_rate_limit", { p_scope: STAFF_MUTATION_RATE_LIMIT_SCOPE }, actorRateLimitResultSchema);
}
