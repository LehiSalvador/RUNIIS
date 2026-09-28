import { createHash, createCipheriv, hkdfSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ciphertextToBytea,
  createPassCredentialService,
  hashPassToken,
  parsePassPayload,
  passCredentials,
  PassCredentialError,
  type IssuedPassCredential,
} from "@/lib/server/crypto/pass-credential";

const V1 = "synthetic-pass-key-material-version-one-000";
const V2 = "synthetic-pass-key-material-version-two-000";
const service = createPassCredentialService(new Map([[1, V1]]));
const rotated = createPassCredentialService(new Map([[1, V1], [2, V2]]));

function failure(fn: () => unknown): PassCredentialError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PassCredentialError);
    return error as PassCredentialError;
  }
  throw new Error("expected PassCredentialError");
}

const stored = (issued: IssuedPassCredential) => ({
  credentialId: issued.credentialId,
  ciphertext: issued.ciphertext,
  keyVersion: issued.keyVersion,
  tokenHash: issued.tokenHash,
});

describe("pass credential issuing", () => {
  it("issues RN1 payloads with a 32-byte base64url token, sha256 hash and iv||tag||ct ciphertext", () => {
    const issued = service.issue();
    const token = parsePassPayload(issued.payload);
    expect(issued.payload).toBe(`RN1.${token}`);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(issued.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(issued.ciphertext.length).toBe(12 + 16 + token.length);
    expect(issued.ciphertext.toString("utf8")).not.toContain(token);
    expect(issued.keyVersion).toBe(1);
    expect(issued.credentialId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("binds the server-generated credential id", () => {
    const id = randomUUID();
    expect(service.issue(id).credentialId).toBe(id);
    expect(failure(() => service.issue("not-a-uuid")).reason).toBe("DECRYPT_FAILED");
  });

  it("never issues the same token twice", () => {
    const hashes = new Set(Array.from({ length: 50 }, () => service.issue().tokenHash));
    expect(hashes.size).toBe(50);
  });

  it("uses the ADR key derivation with AAD RN1|<credential_id>|<key_version>", () => {
    const issued = service.issue();
    const token = parsePassPayload(issued.payload);
    const key = Buffer.from(hkdfSync("sha256", Buffer.from(V1), "runiis-pass-credential", "v1", 32));
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`RN1|${issued.credentialId}|1`));
    const ct = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const blob = Buffer.concat([iv, cipher.getAuthTag(), ct]);
    expect(service.decryptPayload({ ...stored(issued), ciphertext: blob })).toBe(`RN1.${token}`);
  });
});

describe("pass credential decryption", () => {
  it("roundtrips from a Buffer and from PostgREST bytea hex text", () => {
    const issued = service.issue();
    expect(service.decryptPayload(stored(issued))).toBe(issued.payload);
    expect(service.decryptPayload({ ...stored(issued), ciphertext: ciphertextToBytea(issued.ciphertext) })).toBe(issued.payload);
  });

  it.each([
    ["iv", 0],
    ["tag", 12],
    ["ciphertext", 30],
  ])("detects tampering in the %s", (_part, index) => {
    const issued = service.issue();
    const tampered = Buffer.from(issued.ciphertext);
    tampered[index] ^= 0x01;
    expect(failure(() => service.decryptPayload({ ...stored(issued), ciphertext: tampered })).reason).toBe("DECRYPT_FAILED");
  });

  it("rejects a ciphertext swapped onto another credential row (AAD binds the id)", () => {
    const a = service.issue();
    const b = service.issue();
    expect(failure(() => service.decryptPayload({ ...stored(b), ciphertext: a.ciphertext })).reason).toBe("DECRYPT_FAILED");
    expect(failure(() => service.decryptPayload({ ...stored(a), credentialId: b.credentialId })).reason).toBe("DECRYPT_FAILED");
  });

  it("fails closed when the decrypted token does not match the stored hash", () => {
    const a = service.issue();
    const b = service.issue();
    expect(failure(() => service.decryptPayload({ ...stored(a), tokenHash: b.tokenHash })).reason).toBe("HASH_MISMATCH");
    expect(failure(() => service.decryptPayload({ ...stored(a), tokenHash: "zz" })).reason).toBe("DECRYPT_FAILED");
  });

  it("fails on truncated or non-hex stored values", () => {
    const issued = service.issue();
    expect(failure(() => service.decryptPayload({ ...stored(issued), ciphertext: Buffer.alloc(28) })).reason).toBe("DECRYPT_FAILED");
    expect(failure(() => service.decryptPayload({ ...stored(issued), ciphertext: "\\xzz" })).reason).toBe("DECRYPT_FAILED");
  });

  it("fails with a wrong or unknown key version (the version is also bound as AAD)", () => {
    const issued = rotated.issue();
    expect(issued.keyVersion).toBe(2);
    expect(rotated.decryptPayload(stored(issued))).toBe(issued.payload);
    expect(failure(() => rotated.decryptPayload({ ...stored(issued), keyVersion: 1 })).reason).toBe("DECRYPT_FAILED");
    expect(failure(() => service.decryptPayload(stored(issued))).reason).toBe("UNKNOWN_KEY_VERSION");
  });

  it("keeps decrypting credentials issued before a key rotation", () => {
    const old = service.issue();
    expect(rotated.decryptPayload(stored(old))).toBe(old.payload);
    expect(rotated.configuredKeyVersions).toEqual([1, 2]);
  });

  it("does not put plaintext, key material or ciphertext in thrown errors", () => {
    const issued = service.issue();
    const token = parsePassPayload(issued.payload);
    const tampered = Buffer.from(issued.ciphertext);
    tampered[20] ^= 0xff;
    const error = failure(() => service.decryptPayload({ ...stored(issued), ciphertext: tampered }));
    const rendered = `${error.message} ${error.stack ?? ""} ${JSON.stringify(error)}`;
    for (const secret of [token, V1, issued.ciphertext.toString("hex"), tampered.toString("hex")]) {
      expect(rendered).not.toContain(secret);
    }
    const malformed = failure(() => parsePassPayload(`RN1.${token}!`));
    expect(`${malformed.message} ${malformed.stack ?? ""}`).not.toContain(token);
  });
});

describe("token hash and payload parsing", () => {
  it("hashes deterministically", () => {
    const token = "A".repeat(43);
    expect(hashPassToken(token)).toBe(hashPassToken(token));
    expect(hashPassToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPassToken(token)).not.toBe(hashPassToken("B".repeat(43)));
  });

  it("accepts scanner whitespace", () => {
    expect(parsePassPayload(`  RN1.${"a".repeat(43)}\n`)).toBe("a".repeat(43));
  });

  it.each([
    ["missing prefix", "a".repeat(43)],
    ["wrong prefix", `RN2.${"a".repeat(43)}`],
    ["lowercase prefix", `rn1.${"a".repeat(43)}`],
    ["short token", `RN1.${"a".repeat(42)}`],
    ["long token", `RN1.${"a".repeat(44)}`],
    ["padding", `RN1.${"a".repeat(42)}=`],
    ["standard base64 chars", `RN1.${"a".repeat(42)}+`],
    ["empty", ""],
  ])("rejects malformed payload: %s", (_label, payload) => {
    expect(failure(() => parsePassPayload(payload)).reason).toBe("MALFORMED_PAYLOAD");
  });
});

describe("env-bound service and key validation", () => {
  it("builds from PASS_CREDENTIAL_ENCRYPTION_KEY_V<n> env keys", () => {
    const issued = passCredentials().issue();
    expect(passCredentials().decryptPayload(stored(issued))).toBe(issued.payload);
  });

  it("refuses to start without key material, with reused material or with invalid versions", () => {
    expect(() => createPassCredentialService(new Map())).toThrow(/No pass credential encryption keys/);
    expect(() => createPassCredentialService(new Map([[1, V1], [2, V1]]))).toThrow(/distinct/);
    expect(() => createPassCredentialService(new Map([[0, V1]]))).toThrow(/version/);
  });
});
