import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import { createSystemClient } from "../../supabase/clients";
import { participantPassSchema, passListSchema, replaceCredentialResultSchema } from "./contracts";
import { renderPassQrSvg } from "./credentials";

// Route-facing layer over the pass commands (supabase/migrations/20260928140300_143_*.sql). Rendering
// always authorises on the caller's session client first (ownership + rate limit), then decrypts on the
// SYSTEM client (A1): the session client is never given credential material.

const authorizeSchema = z.strictObject({ participant_pass_id: z.guid() });

export async function listMyPasses(supabase: SupabaseClient) {
  const page = await callRpc(supabase, "list_my_passes", {}, passListSchema);
  return page.items;
}

export async function getMyPass(supabase: SupabaseClient, passId: string) {
  return callRpc(supabase, "get_my_pass", { p_participant_pass_id: passId }, participantPassSchema);
}

/** Master §84/A3: SVG for the titular or the buyer of a GUEST pass only. Never logs the token. */
export async function renderMyPassQrSvg(supabase: SupabaseClient, passId: string): Promise<string> {
  await callRpc(supabase, "authorize_pass_render", { p_participant_pass_id: passId }, authorizeSchema);
  return renderPassQrSvg(createSystemClient(), passId);
}

export async function replacePassCredential(supabase: SupabaseClient, passId: string, reason: string, idempotencyKey: string | null) {
  const result = await callRpc(
    supabase,
    "replace_pass_credential",
    { p_participant_pass_id: passId, p_reason: reason, p_idempotency_key: idempotencyKey },
    replaceCredentialResultSchema,
  );
  logEvent("info", "pass_credential_replaced", { participant_pass_id: passId });
  return result;
}
