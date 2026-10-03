import "server-only";
import { hkdfSync } from "node:crypto";
import { createChallenge, verifySolution } from "altcha-lib/v1";
import type { Challenge } from "altcha-lib/v1/types";
import { z } from "zod";
import { getServerEnv } from "../../env";
import { callRpc } from "../../rpc";
import { createSystemClient } from "../../supabase/clients";

// F1/SEC-082: a self-hosted proof-of-work CAPTCHA (ALTCHA), no third-party service and no user data leaves
// RUNIIS. The HMAC key is derived from INTERNAL_CRON_SECRET via HKDF with a distinct info label PER PURPOSE, so
// it never doubles as the cron secret itself, no new env var is needed, and a challenge solved for one purpose
// can never verify for another (P3-D OD-P2-01: the registration-request challenge reuses the mechanism).
// The single-use replay table (private.altcha_replay) is shared: a challenge hash is unguessable without the key.
export type AltchaPurpose = "reminder" | "registration_request";

// The reminder label is the F1 value, unchanged: challenges already in flight keep verifying.
const ALTCHA_HKDF_INFO: Readonly<Record<AltchaPurpose, string>> = {
  reminder: "runiis:altcha:reminder:v1",
  registration_request: "runiis:altcha:registration-request:v1",
};
const ALTCHA_HKDF_KEY_BYTES = 32;
const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes to solve
const CHALLENGE_MAX_NUMBER = 100_000; // bounds solve time on typical client hardware at SHA-256

function altchaHmacKey(purpose: AltchaPurpose): string {
  const secret = getServerEnv().INTERNAL_CRON_SECRET;
  const key = hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from(ALTCHA_HKDF_INFO[purpose], "utf8"), ALTCHA_HKDF_KEY_BYTES);
  return Buffer.from(key).toString("hex");
}

export type AltchaChallenge = Challenge;
export type ReminderChallenge = AltchaChallenge;

/** A fresh challenge for `purpose`: what the frontend ALTCHA widget solves. */
export async function createAltchaChallenge(purpose: AltchaPurpose): Promise<AltchaChallenge> {
  return createChallenge({ hmacKey: altchaHmacKey(purpose), maxnumber: CHALLENGE_MAX_NUMBER, expires: new Date(Date.now() + CHALLENGE_TTL_MS) });
}

/** The GET /api/v1/reminders/challenge contract: what the frontend ALTCHA widget solves. */
export async function createReminderChallenge(): Promise<ReminderChallenge> {
  return createAltchaChallenge("reminder");
}

const replayResultSchema = z.object({ consumed: z.boolean() });

/**
 * Verifies the widget's solved payload (base64 JSON: algorithm/challenge/number/salt/signature)
 * against the HMAC signature of `purpose` and its embedded expiry, then atomically claims the challenge
 * single-use in the DB so a captured/replayed payload never verifies twice (F1). Returns false on
 * any failure without distinguishing the reason -- no oracle for a caller probing the check.
 */
export async function verifyAltchaPayload(purpose: AltchaPurpose, payload: string): Promise<boolean> {
  const hmacKey = altchaHmacKey(purpose);
  let valid: boolean;
  try {
    valid = await verifySolution(payload, hmacKey, true);
  } catch {
    return false;
  }
  if (!valid) return false;

  const decoded = decodePayload(payload);
  if (!decoded) return false;

  const { consumed } = await callRpc(
    createSystemClient(),
    "consume_altcha_challenge",
    { p_challenge: decoded.challenge, p_expires_at: decoded.expiresAt.toISOString() },
    replayResultSchema,
  );
  return consumed;
}

/** Anonymous reminder (F1/SEC-082): behaviour and HKDF label unchanged. */
export async function verifyReminderCaptcha(payload: string): Promise<boolean> {
  return verifyAltchaPayload("reminder", payload);
}

function decodePayload(payload: string): { challenge: string; expiresAt: Date } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const challenge = (parsed as { challenge?: unknown }).challenge;
  const salt = (parsed as { salt?: unknown }).salt;
  if (typeof challenge !== "string" || !/^[0-9a-f]{64}$/.test(challenge)) return null;
  return { challenge, expiresAt: extractExpiry(typeof salt === "string" ? salt : "") };
}

function extractExpiry(salt: string): Date {
  const params = new URLSearchParams(salt.split("?")[1] ?? "");
  const expires = params.get("expires") ?? params.get("expire");
  const parsedSeconds = expires ? Number(expires) : NaN;
  // Defence in depth: even a salt with no/garbled expiry param still gets a bounded replay TTL.
  return Number.isFinite(parsedSeconds) ? new Date(parsedSeconds * 1000) : new Date(Date.now() + CHALLENGE_TTL_MS);
}
