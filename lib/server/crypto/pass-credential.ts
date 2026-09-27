import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { getServerEnv } from "../env";

// ADR-001 decision 8. Plaintext tokens only ever exist in memory: never log, store or cache them.
const TOKEN_BYTES = 32;
const PAYLOAD_PREFIX = "RN1.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes as unpadded base64url
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_SALT = "runiis-pass-credential";

export type PassCredentialFailure = "MALFORMED_PAYLOAD" | "UNKNOWN_KEY_VERSION" | "DECRYPT_FAILED";

/** Carries only a reason code; token, payload and ciphertext never reach the message. */
export class PassCredentialError extends Error {
  constructor(readonly reason: PassCredentialFailure) {
    super(`Pass credential error: ${reason}`);
    this.name = "PassCredentialError";
  }
}

export type IssuedPassCredential = {
  /** `RN1.<token>` to render as QR right after issuing; discard afterwards. */
  payload: string;
  tokenHash: string;
  ciphertext: Buffer;
  keyVersion: number;
};

export type PassCredentialService = {
  currentKeyVersion: number;
  issue(): IssuedPassCredential;
  /** Returns the `RN1.<token>` payload. Call only after authorising the viewer. */
  decryptPayload(ciphertext: Buffer | string, keyVersion: number): string;
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

export function createPassCredentialService(keyMaterial: ReadonlyMap<number, string>): PassCredentialService {
  const keys = new Map<number, Buffer>();
  for (const [version, ikm] of keyMaterial) {
    keys.set(version, Buffer.from(hkdfSync("sha256", Buffer.from(ikm, "utf8"), HKDF_SALT, `v${version}`, KEY_BYTES)));
  }
  if (keys.size === 0) throw new Error("No pass credential encryption keys configured");
  const currentKeyVersion = Math.max(...keys.keys());

  const keyFor = (version: number): Buffer => {
    const key = keys.get(version);
    if (!key) throw new PassCredentialError("UNKNOWN_KEY_VERSION");
    return key;
  };

  return {
    currentKeyVersion,

    issue() {
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", keyFor(currentKeyVersion), iv);
      const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
      return {
        payload: `${PAYLOAD_PREFIX}${token}`,
        tokenHash: hashPassToken(token),
        ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
        keyVersion: currentKeyVersion,
      };
    },

    decryptPayload(stored, keyVersion) {
      const key = keyFor(keyVersion);
      const blob = ciphertextFromBytea(stored);
      if (blob.length <= IV_BYTES + TAG_BYTES) throw new PassCredentialError("DECRYPT_FAILED");
      let token: string;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
        decipher.setAuthTag(blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        token = Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
      } catch {
        throw new PassCredentialError("DECRYPT_FAILED");
      }
      if (!TOKEN_PATTERN.test(token)) throw new PassCredentialError("DECRYPT_FAILED");
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
