import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "../env";

// ADR-001 decision 8 + Amendment 1 A2. Plaintext tokens only ever exist in memory: never log, store or cache them.
const TOKEN_BYTES = 32;
const PAYLOAD_PREFIX = "RN1.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes as unpadded base64url
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
const CREDENTIAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_SALT = "runiis-pass-credential";

export type PassCredentialFailure = "MALFORMED_PAYLOAD" | "UNKNOWN_KEY_VERSION" | "DECRYPT_FAILED" | "HASH_MISMATCH";

/** Carries only a reason code; token, payload and ciphertext never reach the message. */
export class PassCredentialError extends Error {
  constructor(readonly reason: PassCredentialFailure) {
    super(`Pass credential error: ${reason}`);
    this.name = "PassCredentialError";
  }
}

export type IssuedPassCredential = {
  /** Server-generated `participant_pass_credential_id`; bound into the ciphertext as AAD. */
  credentialId: string;
  /** `RN1.<token>` to render as QR right after issuing; discard afterwards. */
  payload: string;
  tokenHash: string;
  ciphertext: Buffer;
  keyVersion: number;
};

export type StoredPassCredential = {
  credentialId: string;
  /** Buffer or PostgREST bytea text (`\x<hex>`). */
  ciphertext: Buffer | string;
  keyVersion: number;
  tokenHash: string;
};

export type PassCredentialService = {
  currentKeyVersion: number;
  configuredKeyVersions: readonly number[];
  issue(credentialId?: string): IssuedPassCredential;
  /** Returns the `RN1.<token>` payload. Call only after authorising the viewer. Fails closed. */
  decryptPayload(stored: StoredPassCredential): string;
};

/** sha256 hex of the token's base64url text (what the scanner holds after stripping `RN1.`). */
export function hashPassToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Extracts the token from a scanned payload; surrounding whitespace from scanners is tolerated. */
export function parsePassPayload(payload: string): string {
  const trimmed = payload.trim();
  const token = trimmed.startsWith(PAYLOAD_PREFIX) ? trimmed.slice(PAYLOAD_PREFIX.length) : "";
  if (!TOKEN_PATTERN.test(token)) throw new PassCredentialError("MALFORMED_PAYLOAD");
  return token;
}

/** PostgREST exchanges bytea as `\x<hex>` text. */
export function ciphertextToBytea(ciphertext: Buffer): string {
  return `\\x${ciphertext.toString("hex")}`;
}

function ciphertextFromBytea(value: Buffer | string): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (!/^\\x([0-9a-fA-F]{2})+$/.test(value)) throw new PassCredentialError("DECRYPT_FAILED");
  return Buffer.from(value.slice(2), "hex");
}

// Binds a ciphertext to its row and key version: a ciphertext copied onto another credential row fails to decrypt (SEC-034).
function associatedData(credentialId: string, keyVersion: number): Buffer {
  if (!CREDENTIAL_ID_PATTERN.test(credentialId)) throw new PassCredentialError("DECRYPT_FAILED");
  return Buffer.from(`RN1|${credentialId}|${keyVersion}`, "utf8");
}

export function createPassCredentialService(keyMaterial: ReadonlyMap<number, string>): PassCredentialService {
  const keys = new Map<number, Buffer>();
  const seen = new Set<string>();
  for (const [version, ikm] of keyMaterial) {
    if (!Number.isInteger(version) || version < 1) throw new Error("Invalid pass credential key version");
    // Reusing material across versions would make rotation meaningless.
    if (seen.has(ikm)) throw new Error("Pass credential key versions must use distinct key material");
    seen.add(ikm);
    keys.set(version, Buffer.from(hkdfSync("sha256", Buffer.from(ikm, "utf8"), HKDF_SALT, `v${version}`, KEY_BYTES)));
  }
  if (keys.size === 0) throw new Error("No pass credential encryption keys configured");
  const configuredKeyVersions = [...keys.keys()].sort((a, b) => a - b);
  const currentKeyVersion = configuredKeyVersions[configuredKeyVersions.length - 1];

  const keyFor = (version: number): Buffer => {
    const key = keys.get(version);
    if (!key) throw new PassCredentialError("UNKNOWN_KEY_VERSION");
    return key;
  };

  return {
    currentKeyVersion,
    configuredKeyVersions,

    issue(credentialId = randomUUID()) {
      const aad = associatedData(credentialId, currentKeyVersion);
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", keyFor(currentKeyVersion), iv);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
      return {
        credentialId,
        payload: `${PAYLOAD_PREFIX}${token}`,
        tokenHash: hashPassToken(token),
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
        keyVersion: currentKeyVersion,
      };
    },

    decryptPayload({ credentialId, ciphertext, keyVersion, tokenHash }) {
      const key = keyFor(keyVersion);
      const aad = associatedData(credentialId, keyVersion);
      if (!TOKEN_HASH_PATTERN.test(tokenHash)) throw new PassCredentialError("DECRYPT_FAILED");
      const blob = ciphertextFromBytea(ciphertext);
      if (blob.length <= IV_BYTES + TAG_BYTES) throw new PassCredentialError("DECRYPT_FAILED");
      let token: string;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
        decipher.setAAD(aad);
        decipher.setAuthTag(blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        token = Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
      } catch {
        throw new PassCredentialError("DECRYPT_FAILED");
      }
      if (!TOKEN_PATTERN.test(token)) throw new PassCredentialError("DECRYPT_FAILED");
      // A token that does not match the stored lookup hash would render a QR that never scans (or scans as someone else).
      if (!timingSafeEqual(Buffer.from(hashPassToken(token), "hex"), Buffer.from(tokenHash, "hex"))) {
        throw new PassCredentialError("HASH_MISMATCH");
      }
      return `${PAYLOAD_PREFIX}${token}`;
    },
  };
}

let service: PassCredentialService | undefined;

/** Service bound to the `PASS_CREDENTIAL_ENCRYPTION_KEY_V<n>` env keys; issues with the highest version. */
export function passCredentials(): PassCredentialService {
  service ??= createPassCredentialService(getServerEnv().passCredentialKeys);
  return service;
}
