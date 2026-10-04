import type { APIRequestContext } from "@playwright/test";
import { challengeMax, encodePayload, solveRange } from "../../../components/registration/logic/altcha-range";
import { safeApi } from "./safe-request";

/**
 * OD-P2-01 (anti-hoarding) from the harness' side. A WhatsApp request from an account younger than 24 h needs a solved ALTCHA
 * challenge. The journeys keep that rule intact; they never bypass it:
 *
 *  - Local (Docker DB): fixture accounts are backdated like users who signed up days ago (`ageFixtureAccount` in account.ts), so a journey
 *    that is not about the challenge is never challenged. The two challenge journeys keep the account fresh on purpose.
 *  - Remote (staging): there is no safe way to age an account (GoTrue stamps `created_at`, the harness only holds the server key of the
 *    Auth API, never a SQL path). Fixture accounts stay NEW, the browser journeys pass the real widget, and the journeys that create the
 *    request through the API use `altchaPayloadFor` below: the same documented contract (probe, solve, send `altcha`), nothing skipped.
 */
export type ChallengeProbe = { applies: boolean; required: boolean; challenge: { algorithm: "SHA-1" | "SHA-256" | "SHA-512"; challenge: string; salt: string; signature: string; maxnumber?: number } | null };

/** GET /registration-requests/challenge for the signed-in buyer; the server alone says whether a challenge is needed. */
export async function probeChallenge(request: APIRequestContext, editionId: string): Promise<ChallengeProbe> {
  const response = await safeApi(request).get(`/api/v1/registration-requests/challenge?edition_id=${editionId}`);
  if (response.status() !== 200) throw new Error(`challenge probe answered ${response.status()}`);
  return ((await response.json()) as { data: ChallengeProbe }).data;
}

/** The solved payload to add to the POST body when the server requires it, otherwise undefined. A payload is single use. */
export async function altchaPayloadFor(request: APIRequestContext, editionId: string): Promise<string | undefined> {
  const probe = await probeChallenge(request, editionId);
  if (!probe.required || !probe.challenge) return undefined;
  const started = Date.now();
  const solution = await solveRange(probe.challenge, 0, challengeMax(probe.challenge));
  if (!solution) throw new Error("ALTCHA challenge has no solution within its bound");
  return encodePayload(probe.challenge, solution.number, Date.now() - started);
}
