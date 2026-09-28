import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { callRpc } from "../../rpc";
import { createSystemClient } from "../../supabase/clients";
import type { RecordEmailProviderEventArgs } from "./webhook";
import {
  anonymousReminderResultSchema,
  confirmReminderResultSchema,
  favoriteListSchema,
  favoriteResultSchema,
  preferencesResultSchema,
  reminderResultSchema,
  unsubscribeResultSchema,
} from "./contracts";

// ---- Favorites (Master §127-129) ----

export const addEditionFavorite = (supabase: SupabaseClient, editionId: string) =>
  callRpc(supabase, "add_edition_favorite", { p_edition_id: editionId }, favoriteResultSchema);

export const removeEditionFavorite = (supabase: SupabaseClient, editionId: string) =>
  callRpc(supabase, "remove_edition_favorite", { p_edition_id: editionId }, favoriteResultSchema);

export const listMyFavorites = (supabase: SupabaseClient) => callRpc(supabase, "list_my_favorites", {}, favoriteListSchema);

// ---- Reminders: logged-in (Master §127-130) ----

export const createEditionReminder = (supabase: SupabaseClient, editionId: string) =>
  callRpc(supabase, "create_edition_reminder", { p_edition_id: editionId }, reminderResultSchema);

export const cancelReminder = (supabase: SupabaseClient, reminderId: string) =>
  callRpc(supabase, "cancel_reminder", { p_reminder_id: reminderId }, reminderResultSchema);

// ---- Reminders: anonymous with email confirmation (Master §130, SEC-082) ----
// SYSTEM only: the route applies IP/email rate limits and CAPTCHA before these run, and the response
// is identical regardless of the email's real state (no address oracle).

export function requestAnonymousReminder(editionId: string, email: string) {
  return callRpc(createSystemClient(), "request_anonymous_reminder", { p_edition_id: editionId, p_email: email }, anonymousReminderResultSchema);
}

export function confirmAnonymousReminder(plaintextToken: string) {
  return callRpc(createSystemClient(), "confirm_anonymous_reminder", { p_token_hash: hashToken(plaintextToken) }, confirmReminderResultSchema);
}

// ---- Preferences (Master §127, §176) ----

export const getMyCommunicationPreferences = (supabase: SupabaseClient) => callRpc(supabase, "get_my_communication_preferences", {}, preferencesResultSchema);

export const updateMyCommunicationPreferences = (
  supabase: SupabaseClient,
  patch: { general_marketing?: boolean | null; event_reminder?: boolean | null; other_optional?: boolean | null },
) =>
  callRpc(
    supabase,
    "update_my_communication_preferences",
    { p_general_marketing: patch.general_marketing ?? null, p_event_reminder: patch.event_reminder ?? null, p_other_optional: patch.other_optional ?? null },
    preferencesResultSchema,
  );

// ---- One-click unsubscribe (SEC-084, RFC 8058) ----

export function unsubscribeWithToken(plaintextToken: string) {
  return callRpc(createSystemClient(), "unsubscribe_with_token", { p_token_hash: hashToken(plaintextToken) }, unsubscribeResultSchema);
}

function hashToken(plaintextToken: string): string {
  return createHash("sha256").update(plaintextToken, "utf8").digest("hex");
}

const rateLimitPrecheckSchema = z.object({ allowed: z.literal(true) });

/** SUPPLIED-subject pre-check (IP/email), consumed in Next before an anonymous command runs (ADR-001 A6). */
export function consumeCommunicationRateLimit(scope: string, subject: string): Promise<{ allowed: true }> {
  return callRpc(createSystemClient(), "consume_subject_rate_limit", { p_scope: scope, p_subject: subject }, rateLimitPrecheckSchema);
}

const providerEventResultSchema = z.object({ status: z.string() });

/** SYSTEM only: records one provider webhook/reconcile event (SEC-080 — the webhook route calls this). */
export function recordEmailProviderEvent(args: RecordEmailProviderEventArgs) {
  return callRpc(createSystemClient(), "record_email_provider_event", args, providerEventResultSchema);
}
