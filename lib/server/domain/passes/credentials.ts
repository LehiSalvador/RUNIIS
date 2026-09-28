import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { z } from "zod";
import { ciphertextToBytea, passCredentials, PassCredentialError, type PassCredentialService } from "../../crypto/pass-credential";
import { AppError } from "../../http/errors";
import { logEvent } from "../../log";
import { callRpc } from "../../rpc";

// ADR-001 Amendment 1 A1: ACTIVE credentials are issued only by the SYSTEM (service_role) client, right
// after the confirming command commits, by the issue-pending-credentials worker, and lazily on render.
// Callers of this module have already authorised the viewer; nothing here returns or logs the token.

const issueResultSchema = z.object({
  participant_pass_id: z.uuid(),
  participant_pass_credential_id: z.uuid().nullable(),
  issued: z.boolean(),
  reason: z.enum(["ISSUED", "ALREADY_ACTIVE", "NOT_ISSUABLE"]),
});
const materialSchema = z
  .object({
    participant_pass_credential_id: z.uuid(),
    token_hash: z.string().regex(/^[0-9a-f]{64}$/),
    token_ciphertext: z.string().regex(/^\\x([0-9a-f]{2})+$/i),
    encryption_key_version: z.int().positive(),
  })
  .nullable();
const passIdListSchema = z.array(z.uuid());
const keyVersionsSchema = z.array(z.int().positive());

export type IssueOutcome = z.output<typeof issueResultSchema>["reason"];

/** Issues version N+1 for an ACTIVE pass of a CONFIRMED Registration that has no ACTIVE credential. */
export async function issueCredential(system: SupabaseClient, passId: string, crypto: PassCredentialService = passCredentials()): Promise<IssueOutcome> {
  const credential = crypto.issue();
  const result = await callRpc(
    system,
    "issue_pass_credential",
    {
      p_participant_pass_id: passId,
      p_participant_pass_credential_id: credential.credentialId,
      p_token_hash: credential.tokenHash,
      p_token_ciphertext: ciphertextToBytea(credential.ciphertext),
      p_encryption_key_version: credential.keyVersion,
    },
    issueResultSchema,
  );
  return result.reason;
}

/** Issues every missing credential (optionally of one request); failures are logged and left for the worker. */
export async function issuePendingCredentials(
  system: SupabaseClient,
  options: { registrationRequestId?: string; limit?: number } = {},
): Promise<{ issued: number; failed: number; remaining: boolean }> {
  const limit = options.limit ?? 100;
  const passIds = await callRpc(
    system,
    "list_passes_missing_credential",
    { p_limit: limit, p_registration_request_id: options.registrationRequestId ?? null },
    passIdListSchema,
  );
  let issued = 0;
  let failed = 0;
  for (const passId of passIds) {
    try {
      if ((await issueCredential(system, passId)) === "ISSUED") issued += 1;
    } catch (error) {
      failed += 1;
      logEvent("warn", "pass_credential_issue_failed", {
        participant_pass_id: passId,
        error_code: error instanceof AppError ? error.code : error instanceof PassCredentialError ? error.reason : "UNEXPECTED",
      });
    }
  }
  return { issued, failed, remaining: passIds.length === limit };
}

/** Post-commit step of FREE/confirm/revalidate/replace: never fails the user's request. */
export async function issueCredentialsAfterCommit(system: SupabaseClient, registrationRequestId: string | null, passId?: string): Promise<void> {
  try {
    if (passId) await issueCredential(system, passId);
    else if (registrationRequestId) await issuePendingCredentials(system, { registrationRequestId });
  } catch (error) {
    logEvent("warn", "pass_credential_post_commit_issue_failed", {
      registration_request_id: registrationRequestId,
      participant_pass_id: passId ?? null,
      error_code: error instanceof AppError ? error.code : "UNEXPECTED",
    });
  }
}

/**
 * Decrypts the pass's ACTIVE credential (issuing it first when missing) and returns the `RN1.<token>`
 * payload. Only for already-authorised viewers: the titular, the buyer of a GUEST pass, or a SYSTEM
 * dispatcher sending the holder's own pass (A3). Fails closed.
 */
export async function activePassPayload(system: SupabaseClient, passId: string, crypto: PassCredentialService = passCredentials()): Promise<string> {
  let material = await callRpc(system, "get_pass_credential_material", { p_participant_pass_id: passId }, materialSchema);
  if (material === null) {
    if ((await issueCredential(system, passId, crypto)) === "NOT_ISSUABLE") throw new AppError("NOT_FOUND");
    material = await callRpc(system, "get_pass_credential_material", { p_participant_pass_id: passId }, materialSchema);
    if (material === null) throw new AppError("CONFLICT", { details: { retryable: true } });
  }
  try {
    return crypto.decryptPayload({
      credentialId: material.participant_pass_credential_id,
      ciphertext: material.token_ciphertext,
      keyVersion: material.encryption_key_version,
      tokenHash: material.token_hash,
    });
  } catch (error) {
    const reason = error instanceof PassCredentialError ? error.reason : "UNEXPECTED";
    // Integrity failures are alerts (SEC-034); a missing key version is an operational outage (SEC-035).
    logEvent("error", "pass_credential_decrypt_failed", {
      participant_pass_id: passId,
      participant_pass_credential_id: material.participant_pass_credential_id,
      encryption_key_version: material.encryption_key_version,
      reason,
    });
    throw new AppError(reason === "UNKNOWN_KEY_VERSION" ? "DEPENDENCY_UNAVAILABLE" : "INTERNAL_ERROR");
  }
}

const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 2 } as const;

export async function renderPassQrSvg(system: SupabaseClient, passId: string): Promise<string> {
  return QRCode.toString(await activePassPayload(system, passId), { ...QR_OPTIONS, type: "svg" });
}

/** PNG for email dispatch (A3: rendered at dispatch time only, never stored). */
export async function renderPassQrPng(system: SupabaseClient, passId: string): Promise<Buffer> {
  return QRCode.toBuffer(await activePassPayload(system, passId), { ...QR_OPTIONS, type: "png", width: 480 });
}

/** SEC-035 health: every key version referenced by an ACTIVE credential is configured. Booleans only. */
export async function passKeyHealth(
  system: SupabaseClient,
  crypto: PassCredentialService = passCredentials(),
): Promise<{ key_versions_ok: boolean }> {
  const inUse = await callRpc(system, "pass_credential_key_versions_in_use", {}, keyVersionsSchema);
  return { key_versions_ok: inUse.every((version) => crypto.configuredKeyVersions.includes(version)) };
}
