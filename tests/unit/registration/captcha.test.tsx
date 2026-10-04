import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createChallenge, verifySolution } from "altcha-lib/v1";
import { describe, expect, test } from "vitest";
import { CaptchaPanel } from "@/components/registration/captcha-panel";
import { challengeExpiresAt, challengeMax, encodePayload, MAX_SOLVE_NUMBER, solveAltcha } from "@/components/registration/logic/altcha-solver";
import {
  CAPTCHA_COPY,
  captchaBlocksSubmit,
  captchaFailureOf,
  captchaVisible,
  renewDelayMs,
  type CaptchaState,
} from "@/components/registration/logic/captcha";
import { interpretCreateFailure } from "@/components/registration/logic/errors";
import { initialDraft, setAccepted, setModality, setResponse } from "@/components/registration/logic/model";
import { StepReview } from "@/components/registration/step-review";
import type { ApiFailure } from "@/lib/client/api";
import { altchaChallengeSchema } from "@/lib/shared/registration";
import { ID, peopleContext } from "./fixtures";

// P3-D2 (OD-P2-01, P3-AC-13 participant side): the pure half of the anti-hoarding challenge in /inscripcion. The browser flow is proved
// by tests/e2e/journeys/challenge.spec.ts; here: when the panel shows and when it holds the submit back, how the 422 reasons map, and that
// the payload the solver builds is exactly what the server's verifier (altcha-lib, the same call captcha.ts makes) accepts.

const HMAC = "unit-test-hmac-key-for-the-client-solver";
const EDITION = "50000000-0000-4000-8000-0000000c0001";

async function issue(number: number, maxnumber = 400, expires = new Date(Date.now() + 90_000)) {
  return createChallenge({ hmacKey: HMAC, number, maxnumber, expires });
}

function failure(code: string, status: number, details: Record<string, unknown> = {}): ApiFailure {
  return { ok: false, status, code: code as ApiFailure["code"], message: "", requestId: null, details };
}

async function captcha422(reason: "captcha_required" | "captcha_invalid") {
  const challenge = await issue(7);
  return failure("BUSINESS_RULE_VIOLATION", 422, {
    reason,
    captcha: { purpose: "registration_request", edition_id: EDITION, new_account_hours: 24, challenge, challenge_endpoint: "/api/v1/registration-requests/challenge" },
  });
}

describe("P3-AC-13: the challenge panel and the submit button follow the server's answer", () => {
  const states: [string, CaptchaState, { visible: boolean; blocks: boolean }][] = [
    ["not asked yet (FREE, not on review)", { phase: "idle" }, { visible: false, blocks: false }],
    ["probing: nothing is shown but the submit waits (no attempt is wasted on a guaranteed 422)", { phase: "checking", renewing: false }, { visible: false, blocks: true }],
    ["the server does not challenge this account: nothing at all", { phase: "not_required" }, { visible: false, blocks: false }],
    ["solving", { phase: "solving", renewing: false }, { visible: true, blocks: true }],
    ["renewing before the two minutes run out", { phase: "checking", renewing: true }, { visible: true, blocks: true }],
    ["solved", { phase: "solved" }, { visible: true, blocks: false }],
    ["the probe failed: the server stays the authority, submit may try (the 422 carries a challenge)", { phase: "error", kind: "probe" }, { visible: true, blocks: false }],
    ["the solve failed on this device: submit waits for a retry", { phase: "error", kind: "solve" }, { visible: true, blocks: true }],
  ];
  test.each(states)("%s", (_name, state, expected) => {
    expect(captchaVisible(state)).toBe(expected.visible);
    expect(captchaBlocksSubmit(state)).toBe(expected.blocks);
    expect(renderToStaticMarkup(<CaptchaPanel state={state} onRetry={() => {}} />).includes('data-testid="captcha-panel"')).toBe(expected.visible);
  });

  test("the panel is a labelled group with a polite live status, never shows a payload, and offers a real retry button on error", () => {
    const solving = renderToStaticMarkup(<CaptchaPanel state={{ phase: "solving", renewing: false }} onRetry={() => {}} />);
    expect(solving).toContain('aria-labelledby="registration-captcha-title"');
    expect(solving).toContain(CAPTCHA_COPY.title);
    expect(solving).toContain('role="status"');
    expect(solving).toContain('aria-live="polite"');
    expect(solving).toContain(CAPTCHA_COPY.solving);
    expect(solving).not.toContain("<button");
    expect(renderToStaticMarkup(<CaptchaPanel state={{ phase: "solved" }} onRetry={() => {}} />)).toContain(CAPTCHA_COPY.solved);
    expect(renderToStaticMarkup(<CaptchaPanel state={{ phase: "checking", renewing: true }} onRetry={() => {}} />)).toContain(CAPTCHA_COPY.renewing);
    const failed = renderToStaticMarkup(<CaptchaPanel state={{ phase: "error", kind: "solve" }} onRetry={() => {}} />);
    expect(failed).toContain(CAPTCHA_COPY.solveFailed);
    expect(failed).toContain(`>${CAPTCHA_COPY.retry}<`);
  });

  test("the review step disables the submit while the challenge holds it and renders the panel before it", () => {
    const ctx = peopleContext("EXTERNAL_WHATSAPP");
    let draft = initialDraft(ctx);
    draft = setModality(ctx, draft, "self", ID.m5k);
    draft = setResponse(draft, "self", "shirt_size", "M");
    draft = setAccepted(draft, "self", ID.waiver, true);
    const render = (blocked: boolean) =>
      renderToStaticMarkup(
        <StepReview
          ctx={ctx}
          draft={draft}
          headingRef={null}
          submitting={false}
          retryAt={null}
          onRetryReady={() => {}}
          blockedReason={null}
          captchaPanel={<CaptchaPanel state={{ phase: "solving", renewing: false }} onRetry={() => {}} />}
          captchaBlocked={blocked}
          onEdit={() => {}}
          onSubmit={() => {}}
        />,
      );
    const held = render(true);
    expect(held).toContain("Apartar mis lugares");
    expect(held.split("Apartar mis lugares")[0].lastIndexOf("<button")).toBeGreaterThan(-1);
    expect(held.indexOf('data-testid="captcha-panel"')).toBeLessThan(held.indexOf("Apartar mis lugares"));
    expect(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Apartar mis lugares/s.test(held)).toBe(true);
    expect(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Apartar mis lugares/s.test(render(false))).toBe(false);
  });
});

describe("P3-AC-13: every captcha reason maps to a clear Spanish message and keeps the user's action intact", () => {
  test("captcha_required carries the fresh challenge and keeps the Idempotency-Key; nothing is refreshed or moved", async () => {
    const action = interpretCreateFailure(await captcha422("captcha_required"), []);
    expect(action.captcha?.reason).toBe("captcha_required");
    expect(altchaChallengeSchema.safeParse(action.captcha?.challenge).success).toBe(true);
    expect(action.keepIdempotencyKey).toBe(true);
    expect(action.refreshContext).toBe(false);
    expect(action.goToStep).toBeNull();
    expect(action.banner.body).toBe(CAPTCHA_COPY.required);
  });

  test("captcha_invalid says so in the contract's words and still carries a fresh challenge for the retry", async () => {
    const action = interpretCreateFailure(await captcha422("captcha_invalid"), []);
    expect(action.captcha?.reason).toBe("captcha_invalid");
    expect(action.captcha?.challenge).not.toBeNull();
    expect(action.banner.title).toBe("La verificación no es válida o expiró. Inténtalo de nuevo.");
    expect(action.keepIdempotencyKey).toBe(true);
  });

  test("details without a usable challenge still map by reason (the flow then asks the server again)", () => {
    const action = interpretCreateFailure(failure("BUSINESS_RULE_VIOLATION", 422, { reason: "captcha_required" }), []);
    expect(action.captcha).toEqual({ reason: "captcha_required", challenge: null });
  });

  test("other business-rule 422s are untouched by the captcha mapping", () => {
    expect(captchaFailureOf(failure("BUSINESS_RULE_VIOLATION", 422, { reason: "source_condition_open" }))).toBeNull();
    expect(captchaFailureOf(failure("VALIDATION_ERROR", 400, { reason: "captcha_required" }))).toBeNull();
    expect(interpretCreateFailure(failure("RATE_LIMITED", 429, {}), []).captcha).toBeNull();
    expect(interpretCreateFailure(failure("CAPACITY_UNAVAILABLE", 409, {}), []).captcha).toBeNull();
  });
});

describe("P3-AC-13: the client solver builds the payload the server verifies", () => {
  test("solves in the browser path (main thread fallback) and the payload passes the server's verifySolution, once expiry is honoured", async () => {
    const challenge = await issue(173);
    const payload = await solveAltcha(challenge, { useWorkers: false });
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as Record<string, unknown>;
    expect(decoded).toMatchObject({ algorithm: challenge.algorithm, challenge: challenge.challenge, number: 173, salt: challenge.salt, signature: challenge.signature });
    expect(await verifySolution(payload, HMAC, true)).toBe(true);
    expect(payload.length).toBeLessThanOrEqual(2000); // altchaPayloadSchema max
  });

  test("a payload for a challenge the server signed differently does not verify (the solver cannot forge)", async () => {
    const challenge = await issue(21);
    const payload = await solveAltcha(challenge, { useWorkers: false });
    expect(await verifySolution(payload, "another-purpose-key", true)).toBe(false);
  });

  test("an expired challenge solves but the server refuses it, and the client reads the expiry from the salt to renew early", async () => {
    const challenge = await issue(5, 50, new Date(Date.now() - 5_000));
    expect(challengeExpiresAt(challenge)).toBeLessThan(Date.now());
    expect(await verifySolution(await solveAltcha(challenge, { useWorkers: false }), HMAC, true)).toBe(false);
  });

  test("an unsolvable challenge rejects instead of spinning, and an aborted solve rejects with AbortError", async () => {
    const challenge = await issue(900, 1000);
    await expect(solveAltcha({ ...challenge, maxnumber: 50 }, { useWorkers: false })).rejects.toMatchObject({ name: "AltchaSolveError" });
    const controller = new AbortController();
    const pending = solveAltcha(await issue(9_000, 10_000), { useWorkers: false, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("a solve that outlasts its deadline rejects instead of leaving the page waiting, and silent workers hand over to the main thread", async () => {
    const hard = await issue(900_000, 1_000_000);
    await expect(solveAltcha(hard, { useWorkers: false, deadlineMs: 30 })).rejects.toMatchObject({ name: "AltchaSolveError", message: "timed out" });
    // No Worker in the node runtime: the worker phase is skipped and the same bound applies to the fallback.
    const easy = await issue(40);
    expect(await verifySolution(await solveAltcha(easy, { workerDeadlineMs: 5 }), HMAC, true)).toBe(true);
  });

  test("bounds: absurd maxnumber is refused, missing maxnumber falls back to the server default, expiry parsing is strict", () => {
    expect(() => challengeMax({ maxnumber: MAX_SOLVE_NUMBER + 1 })).toThrow();
    expect(() => challengeMax({ maxnumber: -1 })).toThrow();
    expect(challengeMax({})).toBe(100_000);
    expect(challengeExpiresAt({ salt: "abc?expires=1893456000&" })).toBe(1893456000_000);
    expect(challengeExpiresAt({ salt: "abc" })).toBeNull();
    expect(challengeExpiresAt({ salt: "abc?expires=soon&" })).toBeNull();
    expect(encodePayload({ algorithm: "SHA-256", challenge: "c", salt: "s", signature: "g" }, 4, 12)).toBe(
      Buffer.from('{"algorithm":"SHA-256","challenge":"c","number":4,"salt":"s","signature":"g","took":12}').toString("base64"),
    );
  });

  test("the renewal fires before the challenge dies, never sooner than a second, and defaults to the documented 2 minutes", () => {
    const now = 1_000_000;
    expect(renewDelayMs(now + 120_000, now)).toBe(110_000);
    expect(renewDelayMs(now + 5_000, now)).toBe(1_000);
    expect(renewDelayMs(null, now)).toBe(110_000);
  });
});
