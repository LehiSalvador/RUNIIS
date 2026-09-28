import "server-only";
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
