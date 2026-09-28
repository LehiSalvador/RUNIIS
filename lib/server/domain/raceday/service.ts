import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPassToken, parsePassPayload, PassCredentialError } from "../../crypto/pass-credential";
import { AppError } from "../../http/errors";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";
import {
  changeKitAllocationSizeResultSchema,
  checkInScanResultSchema,
  guardianDecisionResultSchema,
  guardianVerificationListSchema,
  kitInventorySchema,
  kitPickupResultSchema,
  participantSearchSchema,
  reverseKitPickupResultSchema,
} from "./contracts";

// Route-facing layer over the Race Day commands (supabase/migrations/2026092817*). The scan/pickup
// commands take a `scan_reference` (sha256 hex of the token), computed here so the plaintext token
// never crosses into Postgres (SEC-031); a malformed payload is rejected before it ever reaches the RPC.

function scanReferenceFromPayload(payload: string): string {
  try {
    return hashPassToken(parsePassPayload(payload));
  } catch (error) {
    if (error instanceof PassCredentialError) throw new AppError("VALIDATION_ERROR", { details: { field: "credential_token" } });
    throw error;
  }
}

export async function checkInScan(supabase: SupabaseClient, editionId: string, credentialToken: string, stationKey: string | null) {
  const scanReference = scanReferenceFromPayload(credentialToken);
  const result = await callRpc(
    supabase,
    "raceday_check_in_scan",
    { p_edition_id: editionId, p_scan_reference: scanReference, p_station_key: stationKey },
    checkInScanResultSchema,
  );
  logEvent("info", "raceday_check_in_scan", { edition_id: editionId, outcome: result.outcome });
  return result;
}

export async function manualVerifyCheckIn(
  supabase: SupabaseClient,
  editionId: string,
  participantPassId: string,
  reason: string,
  stationKey: string | null,
  idempotencyKey: string | null,
) {
  const result = await callRpc(
    supabase,
    "raceday_manual_verify",
    { p_edition_id: editionId, p_participant_pass_id: participantPassId, p_reason: reason, p_station_key: stationKey, p_idempotency_key: idempotencyKey },
    checkInScanResultSchema,
  );
  logEvent("info", "raceday_manual_verify", { edition_id: editionId, outcome: result.outcome });
  return result;
}

export async function recordKitPickup(
  supabase: SupabaseClient,
  input: {
    editionId: string;
    kitDefinitionId: string;
    credentialToken?: string;
    registrationId?: string;
    stationKey: string | null;
    thirdParty: boolean;
    thirdPartyReason: string | null;
    idempotencyKey: string | null;
  },
) {
  const scanReference = input.credentialToken ? scanReferenceFromPayload(input.credentialToken) : null;
  const result = await callRpc(
    supabase,
    "raceday_record_kit_pickup",
    {
      p_edition_id: input.editionId,
      p_kit_definition_id: input.kitDefinitionId,
      p_scan_reference: scanReference,
      p_registration_id: input.registrationId ?? null,
      p_station_key: input.stationKey,
      p_third_party: input.thirdParty,
      p_third_party_reason: input.thirdPartyReason,
      p_idempotency_key: input.idempotencyKey,
    },
    kitPickupResultSchema,
  );
  logEvent("info", "raceday_kit_pickup", { edition_id: input.editionId, outcome: result.outcome });
  return result;
}

export async function reverseKitPickup(supabase: SupabaseClient, kitPickupId: string, reason: string, idempotencyKey: string | null) {
  return callRpc(
    supabase,
    "raceday_reverse_kit_pickup",
    { p_kit_pickup_id: kitPickupId, p_reason: reason, p_idempotency_key: idempotencyKey },
    reverseKitPickupResultSchema,
  );
}

export async function changeKitAllocationSize(
  supabase: SupabaseClient,
  kitAllocationId: string,
  newKitVariantId: string,
  reason: string,
  idempotencyKey: string | null,
) {
  return callRpc(
    supabase,
    "raceday_change_kit_allocation_size",
    { p_kit_allocation_id: kitAllocationId, p_new_kit_variant_id: newKitVariantId, p_reason: reason, p_idempotency_key: idempotencyKey },
    changeKitAllocationSizeResultSchema,
  );
}

export async function kitCenterInventory(supabase: SupabaseClient, editionId: string) {
  const page = await callRpc(supabase, "raceday_kit_inventory", { p_edition_id: editionId }, kitInventorySchema);
  return page.items;
}

export async function guardianVerify(supabase: SupabaseClient, registrationId: string, verificationMethod: string, notes: string | null, idempotencyKey: string | null) {
  return callRpc(
    supabase,
    "raceday_guardian_verify",
    { p_registration_id: registrationId, p_verification_method: verificationMethod, p_notes: notes, p_idempotency_key: idempotencyKey },
    guardianDecisionResultSchema,
  );
}

export async function guardianReject(supabase: SupabaseClient, registrationId: string, reason: string, idempotencyKey: string | null) {
  return callRpc(
    supabase,
    "raceday_guardian_reject",
    { p_registration_id: registrationId, p_reason: reason, p_idempotency_key: idempotencyKey },
    guardianDecisionResultSchema,
  );
}

export async function listGuardianVerifications(supabase: SupabaseClient, editionId: string) {
  const page = await callRpc(supabase, "raceday_list_guardian_verifications", { p_edition_id: editionId }, guardianVerificationListSchema);
  return page.items;
}

export async function participantSearch(supabase: SupabaseClient, editionId: string, query: string) {
  const page = await callRpc(supabase, "raceday_participant_search", { p_edition_id: editionId, p_query: query }, participantSearchSchema);
  return page.items;
}
