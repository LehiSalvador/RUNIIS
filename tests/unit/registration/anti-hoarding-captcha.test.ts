import { hkdfSync } from "node:crypto";
import { createChallenge } from "altcha-lib/v1";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AppError } from "@/lib/server/http/errors";

// P3-D OD-P2-01: the Next half of the anti-hoarding rule. The database refuses a challenged buyer without a clearance (pgTAP 721);
// this proves the orchestration around it: RPC first (replays and unaffected buyers never touch the challenge), verify the ALTCHA
// payload for the REGISTRATION purpose (single use), mint the clearance with the service role, retry once, stable errors the UI keys on.

const SECRET = "unit-test-internal-cron-secret-000000000000";
const EDITION_ID = "50000000-0000-4000-8000-000000000001";
const AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const REGISTRATION_INFO = "runiis:altcha:registration-request:v1";
const REMINDER_INFO = "runiis:altcha:reminder:v1";

function hmacKey(info: string): string {
  return Buffer.from(hkdfSync("sha256", Buffer.from(SECRET, "utf8"), Buffer.alloc(0), Buffer.from(info, "utf8"), 32)).toString("hex");
}

async function solved(info: string, number = 5): Promise<string> {
  const challenge = await createChallenge({ hmacKey: hmacKey(info), number, expires: new Date(Date.now() + 60_000) });
  return Buffer.from(
    JSON.stringify({ algorithm: challenge.algorithm, challenge: challenge.challenge, number, salt: challenge.salt, signature: challenge.signature }),
  ).toString("base64");
}

const captchaRequired = () =>
  new AppError("BUSINESS_RULE_VIOLATION", { details: { reason: "captcha_required", captcha: { purpose: "registration_request", new_account_hours: 24 } } });
const view = {
  registration_request_id: "70000000-0000-4000-8000-000000000001",
  status: "PENDING_CONFIRMATION",
  whatsapp_phone_e164: null,
  edition: { edition_id: EDITION_ID, name: "E", slug: "e" },
};

const consumed = new Set<string>();
const rpc = vi.fn();
vi.mock("@/lib/server/rpc", () => ({ callRpc: (...args: unknown[]) => rpc(...args) }));
vi.mock("@/lib/server/supabase/clients", () => ({ createSystemClient: () => ({ system: true }) }));
vi.mock("@/lib/server/domain/passes/credentials", () => ({ issueCredentialsAfterCommit: vi.fn() }));
vi.mock("@/lib/server/log", () => ({ logEvent: vi.fn() }));

const { createRegistrationRequest, getRegistrationCaptchaStatus } = await import("@/lib/server/domain/registration/service");

const user = { user: true };
const body = (altcha?: string) => ({ edition_id: EDITION_ID, participants: [], legal_acceptances: [], ...(altcha ? { altcha } : {}) }) as never;

/** callRpc stand-in: scripted create results, a real single-use table for the ALTCHA replay RPC, and a grant recorder. */
function script(createResults: (() => unknown)[]) {
  const queue = [...createResults];
  rpc.mockImplementation(async (_client: unknown, fn: string, args: Record<string, unknown>) => {
    if (fn === "consume_altcha_challenge") {
      const key = String(args.p_challenge);
      if (consumed.has(key)) return { consumed: false };
      consumed.add(key);
      return { consumed: true };
    }
    if (fn === "grant_registration_captcha_clearance") return { granted: true };
    if (fn === "consume_actor_rate_limit") return { allowed: true };
    if (fn === "create_registration_request") {
      const next = queue.shift();
      if (!next) throw new Error("unexpected extra create call");
      const result = next();
      if (result instanceof Error) throw result;
      return result;
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
}
const calls = (fn: string) => rpc.mock.calls.filter((call) => call[1] === fn);
const failure = async (promise: Promise<unknown>) => (await promise.catch((error: unknown) => error)) as AppError;

beforeEach(() => {
  rpc.mockReset();
  consumed.clear();
});

describe("createRegistrationRequest anti-hoarding orchestration (OD-P2-01)", () => {
  test("a buyer the rule does not concern never touches the challenge (also a stored idempotent replay)", async () => {
    script([() => view]);
    await expect(createRegistrationRequest(user as never, body("already-spent-payload"), "key-0001-abcd", { authUserId: AUTH_USER_ID })).resolves.toMatchObject({
      status: "PENDING_CONFIRMATION",
    });
    expect(calls("create_registration_request")).toHaveLength(1);
    expect(calls("consume_altcha_challenge")).toHaveLength(0);
    expect(calls("grant_registration_captcha_clearance")).toHaveLength(0);
  });

  test("captcha_required without a payload: stable 422 with a fresh challenge for the widget, nothing minted", async () => {
    script([() => captchaRequired()]);
    const app = await failure(createRegistrationRequest(user as never, body(), null, { authUserId: AUTH_USER_ID }));
    expect(app).toBeInstanceOf(AppError);
    expect(app.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(app.status).toBe(422);
    expect(app.details.reason).toBe("captcha_required");
    const captcha = app.details.captcha as Record<string, unknown>;
    expect(captcha.purpose).toBe("registration_request");
    expect(captcha.edition_id).toBe(EDITION_ID);
    expect(captcha.new_account_hours).toBe(24);
    expect(captcha.challenge_endpoint).toBe("/api/v1/registration-requests/challenge");
    expect((captcha.challenge as { challenge: string }).challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(app.publicMessage).toMatch(/persona/);
    expect(calls("grant_registration_captcha_clearance")).toHaveLength(0);
  });

  test("a valid payload mints the clearance for THIS user and Edition (service role) and retries once with the same key", async () => {
    script([() => captchaRequired(), () => view]);
    const result = await createRegistrationRequest(user as never, body(await solved(REGISTRATION_INFO)), "key-0001-abcd", { authUserId: AUTH_USER_ID });
    expect(result.status).toBe("PENDING_CONFIRMATION");
    expect(calls("grant_registration_captcha_clearance")).toHaveLength(1);
    const grant = calls("grant_registration_captcha_clearance")[0];
    expect(grant[0]).toEqual({ system: true });
    expect(grant[2]).toEqual({ p_auth_user_id: AUTH_USER_ID, p_edition_id: EDITION_ID });
    expect(calls("create_registration_request")).toHaveLength(2);
    expect(calls("create_registration_request")[1][2]).toMatchObject({ p_idempotency_key: "key-0001-abcd" });
  });

  test("a payload solved for the REMINDER purpose is invalid here (purposes are cryptographically separated)", async () => {
    script([() => captchaRequired()]);
    const app = await failure(createRegistrationRequest(user as never, body(await solved(REMINDER_INFO)), null, { authUserId: AUTH_USER_ID }));
    expect(app.details.reason).toBe("captcha_invalid");
    expect(calls("grant_registration_captcha_clearance")).toHaveLength(0);
    expect(calls("consume_altcha_challenge")).toHaveLength(0);
  });

  test("a replayed payload is rejected (single use) and mints nothing the second time", async () => {
    const payload = await solved(REGISTRATION_INFO, 9);
    script([() => captchaRequired(), () => view, () => captchaRequired()]);
    await createRegistrationRequest(user as never, body(payload), null, { authUserId: AUTH_USER_ID });
    const app = await failure(createRegistrationRequest(user as never, body(payload), null, { authUserId: AUTH_USER_ID }));
    expect(app.details.reason).toBe("captcha_invalid");
    expect(calls("grant_registration_captcha_clearance")).toHaveLength(1);
  });

  test("garbage and tampered payloads are captcha_invalid, never a 500", async () => {
    for (const payload of ["not-base64-json", "e30=", Buffer.from(JSON.stringify({ challenge: "x" })).toString("base64")]) {
      script([() => captchaRequired()]);
      const app = await failure(createRegistrationRequest(user as never, body(payload), null, { authUserId: AUTH_USER_ID }));
      expect(app.details.reason).toBe("captcha_invalid");
    }
  });

  test("without the session auth user the buyer can only be refused, never cleared", async () => {
    script([() => captchaRequired()]);
    const app = await failure(createRegistrationRequest(user as never, body(await solved(REGISTRATION_INFO, 7)), null));
    expect(app.details.reason).toBe("captcha_required");
    expect(calls("grant_registration_captcha_clearance")).toHaveLength(0);
  });

  test("when the retry is challenged again (clearance spent or expired in between) the buyer is asked again", async () => {
    script([() => captchaRequired(), () => captchaRequired()]);
    const app = await failure(createRegistrationRequest(user as never, body(await solved(REGISTRATION_INFO, 8)), null, { authUserId: AUTH_USER_ID }));
    expect(app.details.reason).toBe("captcha_required");
    expect(calls("create_registration_request")).toHaveLength(2);
  });

  test("any other failure (capacity, validation) passes through untouched, also after a valid payload", async () => {
    const capacity = new AppError("CAPACITY_UNAVAILABLE", { details: { modality_id: "m" } });
    script([() => capacity]);
    await expect(createRegistrationRequest(user as never, body(), null, { authUserId: AUTH_USER_ID })).rejects.toBe(capacity);

    script([() => captchaRequired(), () => capacity]);
    await expect(
      createRegistrationRequest(user as never, body(await solved(REGISTRATION_INFO, 11)), null, { authUserId: AUTH_USER_ID }),
    ).rejects.toBe(capacity);
    expect(calls("grant_registration_captcha_clearance")).toHaveLength(1);
  });

  test("a different BUSINESS_RULE_VIOLATION is not mistaken for the captcha", async () => {
    const other = new AppError("BUSINESS_RULE_VIOLATION", { details: { reason: "something_else" } });
    script([() => other]);
    await expect(
      createRegistrationRequest(user as never, body(await solved(REGISTRATION_INFO, 13)), null, { authUserId: AUTH_USER_ID }),
    ).rejects.toBe(other);
    expect(calls("consume_altcha_challenge")).toHaveLength(0);
  });
});

describe("getRegistrationCaptchaStatus (proactive challenge)", () => {
  const row = (overrides: Record<string, unknown>) => ({ applies: false, required: false, has_clearance: false, new_account_hours: 24, ...overrides });
  const answer = (status: unknown) =>
    rpc.mockImplementation(async (_client: unknown, fn: string) => (fn === "registration_captcha_status" ? status : { allowed: true }));

  test("issues a challenge only when the widget must be shown", async () => {
    answer(row({ applies: true, required: true }));
    const required = await getRegistrationCaptchaStatus(user as never, EDITION_ID);
    expect(required.required).toBe(true);
    expect(required.challenge?.challenge).toMatch(/^[0-9a-f]{64}$/);

    answer(row({ applies: true, has_clearance: true }));
    expect((await getRegistrationCaptchaStatus(user as never, EDITION_ID)).challenge).toBeNull();

    answer(row({}));
    expect(await getRegistrationCaptchaStatus(user as never, EDITION_ID)).toMatchObject({ applies: false, required: false, challenge: null });
  });
});
