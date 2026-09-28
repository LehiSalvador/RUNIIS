import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError } from "../../http/errors";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import { createAnonClient, createSessionClient, createSystemClient } from "../../supabase/clients";
import {
  myProfileSchema,
  onboardingSchema,
  staffGrantSchema,
  staffGrantBodySchema,
  staffRevokeResultSchema,
  staffRosterSchema,
  type profilePatchSchema,
} from "./contracts";

const precheckSchema = z.object({ allowed: z.literal(true) });

/** Committed rate-limit pre-check (ADR-001 A6): its own transaction, so failed attempts still count. */
async function consumeActorRateLimit(supabase: SupabaseClient, scope: string): Promise<void> {
  await callRpc(supabase, "consume_actor_rate_limit", { p_scope: scope }, precheckSchema);
}

/** SUPPLIED-subject pre-check (email/IP); only the SYSTEM client may call this (grants, §7). */
async function consumeSubjectRateLimit(scope: string, subject: string): Promise<void> {
  await callRpc(createSystemClient(), "consume_subject_rate_limit", { p_scope: scope, p_subject: subject }, precheckSchema);
}

// ---- Onboarding / profile (Master §16, §166) ----

export async function ensureRunnerProfile(supabase: SupabaseClient) {
  return callRpc(supabase, "ensure_runner_profile", {}, myProfileSchema);
}

export async function completeOnboarding(
  supabase: SupabaseClient,
  fields: z.output<typeof onboardingSchema>,
  idempotencyKey: string | null,
) {
  const profile = await callRpc(
    supabase,
    "complete_onboarding",
    {
      p_full_name: fields.full_name,
      p_date_of_birth: fields.date_of_birth,
      p_sex_code: fields.sex_code,
      p_phone_e164: fields.phone_e164,
      p_emergency_contact_name: fields.emergency_contact_name,
      p_emergency_contact_phone_e164: fields.emergency_contact_phone_e164,
      p_emergency_contact_relationship: fields.emergency_contact_relationship,
      p_idempotency_key: idempotencyKey,
    },
    myProfileSchema,
  );
  logEvent("info", "onboarding_completed", { runner_profile_id: profile.runner_profile_id });
  return profile;
}

export async function getMyProfile(supabase: SupabaseClient) {
  return callRpc(supabase, "get_my_profile", {}, myProfileSchema);
}

export async function updateMyProfile(supabase: SupabaseClient, changes: z.output<typeof profilePatchSchema>) {
  return callRpc(supabase, "update_my_profile", { p_changes: changes }, myProfileSchema);
}

// ---- OTP sign-in (Master §17; SEC-041/043; F3 targeted-lockout mitigation) ----

/** F3: combines the normalized email with the client IP so a single attacker IP hammering a
 * victim email hits its own tight bucket instead of the victim's -- never used alone. */
function emailIpSubject(email: string, clientIp: string): string {
  return `${email}|${clientIp}`;
}

/** Identical outcome for new/existing/banned/blocked emails: caller always gets a 202 (SEC-043). */
export async function requestOtp(email: string, clientIp: string): Promise<void> {
  await consumeSubjectRateLimit("auth.otp.ip", clientIp);
  await consumeSubjectRateLimit("auth.otp.email", email);
  // F3: the tight per-hour bucket is keyed on (email, IP) so one attacker IP cannot exhaust a
  // victim's quota; the higher email-only ceiling is the backstop against a distributed attacker.
  await consumeSubjectRateLimit("auth.otp.email.hour", emailIpSubject(email, clientIp));
  await consumeSubjectRateLimit("auth.otp.email.hour.global", email);
  const { error } = await createAnonClient().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) logEvent("warn", "otp_request_upstream_error", { reason: error.name });
}

/** Verifies the code, persists the session via HttpOnly cookies, then ensures a profile exists. */
export async function verifyOtp(email: string, code: string, clientIp: string) {
  await consumeSubjectRateLimit("auth.verify.ip", clientIp);
  // F3: same (email, IP) keying plus a higher email-only ceiling as the OTP request bucket above.
  await consumeSubjectRateLimit("auth.verify.email", emailIpSubject(email, clientIp));
  await consumeSubjectRateLimit("auth.verify.email.global", email);

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.session) {
    throw new AppError("VALIDATION_ERROR", { details: { field: "code" } });
  }
  const profile = await ensureRunnerProfile(supabase);
  logEvent("info", "otp_verified", { runner_profile_id: profile.runner_profile_id });
  return profile;
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
}

// ---- Staff role management (Master §144-145; SEC-021/022) ----

export async function listStaffRoles(supabase: SupabaseClient) {
  return callRpc(supabase, "list_staff_roles", {}, staffRosterSchema);
}

export async function grantStaffRole(supabase: SupabaseClient, body: z.output<typeof staffGrantBodySchema>) {
  await consumeActorRateLimit(supabase, "admin.mutation");
  const result = await callRpc(
    supabase,
    "grant_staff_role",
    { p_email: body.email, p_role: body.role, p_scope_type: body.scope_type, p_edition_id: body.edition_id ?? null },
    staffGrantSchema,
  );
  logEvent("info", "staff_role_granted", { staff_role_assignment_id: result.staff_role_assignment_id });
  return result;
}

export async function revokeStaffRole(supabase: SupabaseClient, roleAssignmentId: string) {
  await consumeActorRateLimit(supabase, "admin.mutation");
  const result = await callRpc(supabase, "revoke_staff_role", { p_role_assignment_id: roleAssignmentId }, staffRevokeResultSchema);
  logEvent("info", "staff_role_revoked", { staff_role_assignment_id: result.staff_role_assignment_id });
  return result;
}
