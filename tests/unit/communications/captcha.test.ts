import { hkdfSync } from "node:crypto";
import { createChallenge } from "altcha-lib/v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INTERNAL_CRON_SECRET = "c".repeat(32);
const HKDF_INFO = "runiis:altcha:reminder:v1"; // must mirror lib/server/domain/communications/captcha.ts

function testHmacKey(): string {
  const key = hkdfSync("sha256", Buffer.from(INTERNAL_CRON_SECRET, "utf8"), Buffer.alloc(0), Buffer.from(HKDF_INFO, "utf8"), 32);
  return Buffer.from(key).toString("hex");
}

async function solvedPayload(overrides: { number?: number; expiresInMs?: number; hmacKey?: string } = {}): Promise<string> {
  const challenge = await createChallenge({
    hmacKey: overrides.hmacKey ?? testHmacKey(),
    number: overrides.number ?? 7,
    expires: new Date(Date.now() + (overrides.expiresInMs ?? 60_000)),
  });
  const payload = { algorithm: challenge.algorithm, challenge: challenge.challenge, number: overrides.number ?? 7, salt: challenge.salt, signature: challenge.signature };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

const rpcMock = vi.fn(async (_client: unknown, fn: string, args: Record<string, unknown>) => {
  if (fn !== "consume_altcha_challenge") throw new Error(`unexpected rpc: ${fn}`);
  const key = String(args.p_challenge);
  if (consumed.has(key)) return { consumed: false };
  consumed.add(key);
  return { consumed: true };
});
const consumed = new Set<string>();

vi.mock("@/lib/server/rpc", () => ({ callRpc: (...args: Parameters<typeof rpcMock>) => rpcMock(...args) }));
vi.mock("@/lib/server/supabase/clients", () => ({ createSystemClient: () => ({}) }));
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => ({ INTERNAL_CRON_SECRET }) }));

const { verifyReminderCaptcha, createReminderChallenge } = await import("@/lib/server/domain/communications/captcha");

beforeEach(() => {
  consumed.clear();
  rpcMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createReminderChallenge (F1/SEC-082)", () => {
  it("issues an ALTCHA challenge shaped for the widget contract", async () => {
    const challenge = await createReminderChallenge();
    expect(challenge.algorithm).toBe("SHA-256");
    expect(challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.signature).toMatch(/^[0-9a-f]+$/);
    expect(typeof challenge.salt).toBe("string");
  });

  it("two challenges never share the same value (fresh salt/number each time)", async () => {
    const a = await createReminderChallenge();
    const b = await createReminderChallenge();
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe("verifyReminderCaptcha (F1/SEC-082)", () => {
  it("accepts a correctly solved, unexpired payload and consumes it in the DB", async () => {
    const payload = await solvedPayload();
    await expect(verifyReminderCaptcha(payload)).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      expect.anything(),
      "consume_altcha_challenge",
      expect.objectContaining({ p_challenge: expect.stringMatching(/^[0-9a-f]{64}$/) }),
      expect.anything(),
    );
  });

  it("rejects replay: the same solved payload verifies only once", async () => {
    const payload = await solvedPayload();
    await expect(verifyReminderCaptcha(payload)).resolves.toBe(true);
    await expect(verifyReminderCaptcha(payload)).resolves.toBe(false);
  });

  it("rejects a payload signed with the wrong HMAC key", async () => {
    const payload = await solvedPayload({ hmacKey: "0".repeat(64) });
    await expect(verifyReminderCaptcha(payload)).resolves.toBe(false);
  });

  it("rejects a wrong solution number (PoW not actually done)", async () => {
    const real = await createChallenge({ hmacKey: testHmacKey(), number: 7, expires: new Date(Date.now() + 60_000) });
    const forged = { algorithm: real.algorithm, challenge: real.challenge, number: 999, salt: real.salt, signature: real.signature };
    const payload = Buffer.from(JSON.stringify(forged), "utf8").toString("base64");
    await expect(verifyReminderCaptcha(payload)).resolves.toBe(false);
  });

  it("rejects an expired challenge", async () => {
    const payload = await solvedPayload({ expiresInMs: -60_000 });
    await expect(verifyReminderCaptcha(payload)).resolves.toBe(false);
  });

  it("rejects malformed base64/JSON without throwing", async () => {
    await expect(verifyReminderCaptcha("not-base64-json")).resolves.toBe(false);
    await expect(verifyReminderCaptcha("")).resolves.toBe(false);
  });

  it("never calls the replay RPC when the signature/solution check already failed", async () => {
    const payload = await solvedPayload({ hmacKey: "0".repeat(64) });
    await verifyReminderCaptcha(payload);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
