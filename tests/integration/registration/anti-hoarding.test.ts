import { randomUUID } from "node:crypto";
import { solveChallenge } from "altcha-lib/v1";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createAltchaChallenge } from "@/lib/server/domain/communications/captcha";
import { cleanup, createTestStaff, createTestUser, queryValue, sql, type TestStaff, type TestUser } from "../helpers";
import { callRoute, type RouteHandler } from "../closure/harness";
import { buildEdition, selfAcceptance, type EditionFixture } from "./helpers";

// P3-D OD-P2-01 measure 1 (P3-AC-13): ALTCHA for EXTERNAL_WHATSAPP requests of accounts younger than 24 h (server time), over the real route
// modules and the real RPC. Proves: <24 h WhatsApp needs a valid challenge, >=24 h and FREE do not, invalid/foreign-purpose/replayed
// payloads are rejected, an idempotent replay never re-asks, a failed command keeps the clearance, and no alternate endpoint bypasses the
// rule (the RPC callable by `authenticated` enforces it, and the clearance can only be minted with the service role).

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: cache.revalidateTag }));
vi.mock("@/lib/server/supabase/clients", async (importOriginal) => {
  const { sessionStore: store, sessionOrAnon } = await import("../closure/harness");
  return { ...(await importOriginal<typeof import("@/lib/server/supabase/clients")>()), createSessionClient: async () => store.getStore() ?? sessionOrAnon(null) };
});

import { POST as createPost } from "@/app/api/v1/registration-requests/route";
import { GET as challengeGet } from "@/app/api/v1/registration-requests/challenge/route";

const asHandler = (route: unknown) => route as RouteHandler;

async function payloadFor(challenge: { algorithm: string; challenge: string; salt: string; signature: string; maxnumber?: number }): Promise<string> {
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
  if (!solution) throw new Error("challenge not solvable");
  return Buffer.from(
    JSON.stringify({ algorithm: challenge.algorithm, challenge: challenge.challenge, number: solution.number, salt: challenge.salt, signature: challenge.signature }),
  ).toString("base64");
}

describe("anti-hoarding ALTCHA gate (OD-P2-01) integration", () => {
  const authUserIds: string[] = [];
  let whatsapp: EditionFixture;
  let free: EditionFixture;
  let fresh: TestUser;
  let fresh2: TestUser;
  let established: TestUser;
  let admin: TestStaff;

  const body = (user: TestUser, edition: EditionFixture, extra: Record<string, unknown> = {}) => ({
    edition_id: edition.editionId,
    participants: [{ kind: "PROFILE", public_profile_id: user.publicProfileId, modality_id: edition.modalityId }],
    legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
    ...extra,
  });
  const create = (user: TestUser, payload: unknown, key?: string | null) =>
    callRoute(asHandler(createPost), { path: "/api/v1/registration-requests", body: payload, as: user.client, key });
  const status = (user: TestUser, edition: EditionFixture) =>
    callRoute(asHandler(challengeGet), { method: "GET", path: `/api/v1/registration-requests/challenge?edition_id=${edition.editionId}`, as: user.client });
  const requestCount = (user: TestUser, edition: EditionFixture) =>
    Number(queryValue(`select count(*) from app.registration_request where buyer_profile_id = '${user.runnerProfileId}' and edition_id = '${edition.editionId}'`));
  const holdCount = (edition: EditionFixture) =>
    Number(queryValue(`select count(*) from app.registration_hold h join app.registration_request r using (registration_request_id) where r.edition_id = '${edition.editionId}'`));
  const clearances = (user: TestUser) => Number(queryValue(`select count(*) from private.registration_captcha_clearance where auth_user_id = '${user.authUserId}'`));
  const cancelPending = async (user: TestUser, requestId: string) => {
    const { error } = await user.client.rpc("cancel_registration_request", { p_registration_request_id: requestId, p_reason: null, p_idempotency_key: null });
    expect(error).toBeNull();
  };

  beforeAll(async () => {
    admin = await createTestStaff("ADMIN", "GLOBAL");
    authUserIds.push(admin.authUserId);
    whatsapp = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 50, priceAmountMinor: 20000 });
    free = await buildEdition(admin.client, { mode: "FREE" });
    fresh = await createTestUser({ label: "p3d-fresh", freshAccount: true });
    fresh2 = await createTestUser({ label: "p3d-fresh2", freshAccount: true });
    established = await createTestUser({ label: "p3d-established" });
    authUserIds.push(fresh.authUserId, fresh2.authUserId, established.authUserId);
  }, 180_000);

  // registration_request.create allows 5 attempts per actor per 10 minutes (failed ones count); each test starts from a clean budget.
  beforeEach(() => {
    sql("delete from infra.rate_limit_counter where scope like 'registration_request.create%'");
  });

  afterAll(async () => {
    await cleanup(authUserIds);
  });

  test("the account age is the server's: fresh accounts are new, the backdated fixture is established", () => {
    expect(queryValue(`select private.registration_account_is_new('${fresh.authUserId}')`)).toBe("t");
    expect(queryValue(`select private.registration_account_is_new('${established.authUserId}')`)).toBe("f");
  });

  test("FREE and established accounts never see a challenge; the proactive endpoint says so", async () => {
    expect((await status(fresh, free)).body.data).toMatchObject({ applies: false, required: false, challenge: null });
    expect((await status(established, whatsapp)).body.data).toMatchObject({ applies: false, required: false, challenge: null });
    const freeRegistration = await create(fresh, body(fresh, free));
    expect(freeRegistration.status).toBe(201);
    expect(freeRegistration.body.data.status).toBe("CONFIRMED");
    const established201 = await create(established, body(established, whatsapp));
    expect(established201.status).toBe(201);
    expect(established201.body.data.status).toBe("PENDING_CONFIRMATION");
  });

  test("a <24 h account on a WhatsApp Edition is asked for the challenge before any hold exists", async () => {
    const proactive = await status(fresh, whatsapp);
    expect(proactive.body.data).toMatchObject({ applies: true, required: true, has_clearance: false, new_account_hours: 24 });
    expect(proactive.body.data.challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(proactive.headers.get("cache-control")).toBe("private, no-store");

    const refused = await create(fresh, body(fresh, whatsapp));
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(refused.body.error.details.reason).toBe("captcha_required");
    expect(refused.body.error.details.captcha).toMatchObject({
      purpose: "registration_request",
      edition_id: whatsapp.editionId,
      new_account_hours: 24,
      challenge_endpoint: "/api/v1/registration-requests/challenge",
    });
    expect(refused.body.error.details.captcha.challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(refused.body.error.message).toMatch(/persona/);
    expect(requestCount(fresh, whatsapp)).toBe(0);
  });

  test("invalid, tampered and foreign-purpose payloads are rejected as captcha_invalid and mint nothing", async () => {
    const invalid = await create(fresh, body(fresh, whatsapp, { altcha: "bm90LWpzb24=" }));
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details.reason).toBe("captcha_invalid");
    expect(invalid.body.error.details.captcha.challenge.challenge).toMatch(/^[0-9a-f]{64}$/);

    // A payload solved for the anonymous-reminder purpose does not open a registration.
    const { createReminderChallenge } = await import("@/lib/server/domain/communications/captcha");
    const foreign = await payloadFor(await createReminderChallenge());
    expect((await create(fresh, body(fresh, whatsapp, { altcha: foreign }))).body.error.details.reason).toBe("captcha_invalid");

    // Tampered signature.
    const real = await createAltchaChallenge("registration_request");
    const solvedReal = JSON.parse(Buffer.from(await payloadFor(real), "base64").toString("utf8")) as Record<string, unknown>;
    const tampered = Buffer.from(JSON.stringify({ ...solvedReal, number: 99_999 })).toString("base64");
    expect((await create(fresh, body(fresh, whatsapp, { altcha: tampered }))).body.error.details.reason).toBe("captcha_invalid");
    expect(requestCount(fresh, whatsapp)).toBe(0);
    expect(clearances(fresh)).toBe(0);
    expect(holdCount(whatsapp)).toBe(1); // only the established account's hold from the previous test
  });

  test("a valid payload creates the request; an idempotent replay never re-asks; the payload is single use", async () => {
    const key = `p3d-create-${randomUUID()}`;
    const payload = await payloadFor((await status(fresh, whatsapp)).body.data.challenge);
    const created = await create(fresh, body(fresh, whatsapp, { altcha: payload }), key);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("PENDING_CONFIRMATION");
    expect(clearances(fresh)).toBe(0); // consumed by the success

    // Same key, same body, the already-spent payload (a client retry after a lost response): the stored response, not a captcha error.
    const replay = await create(fresh, body(fresh, whatsapp, { altcha: payload }), key);
    expect(replay.status).toBe(201);
    expect(replay.body.data.registration_request_id).toBe(created.body.data.registration_request_id);
    // ...and with no payload at all.
    expect((await create(fresh, body(fresh, whatsapp), key)).body.data.registration_request_id).toBe(created.body.data.registration_request_id);
    expect(requestCount(fresh, whatsapp)).toBe(1);

    // After canceling, a NEW request with the same spent payload (new key) is refused: the challenge is single use.
    await cancelPending(fresh, created.body.data.registration_request_id);
    const spent = await create(fresh, body(fresh, whatsapp, { altcha: payload }), `p3d-create-${randomUUID()}`);
    expect(spent.status).toBe(422);
    expect(spent.body.error.details.reason).toBe("captcha_invalid");
    // One clearance buys one request: without a fresh solve the next attempt is asked again.
    expect((await create(fresh, body(fresh, whatsapp), `p3d-create-${randomUUID()}`)).body.error.details.reason).toBe("captcha_required");
    sql("delete from infra.rate_limit_counter where scope like 'registration_request.create%'");
    const again = await create(fresh, body(fresh, whatsapp, { altcha: await payloadFor((await status(fresh, whatsapp)).body.data.challenge) }));
    expect(again.status).toBe(201);
  });

  test("a failed command keeps the clearance: the corrected retry needs no second solve", async () => {
    const payload = await payloadFor((await status(fresh2, whatsapp)).body.data.challenge);
    const wrongModality = body(fresh2, whatsapp, { altcha: payload });
    (wrongModality.participants[0] as { modality_id: string }).modality_id = randomUUID();
    const failed = await create(fresh2, wrongModality);
    expect(failed.status).toBe(422);
    expect(failed.body.error.code).not.toBe("BUSINESS_RULE_VIOLATION");
    expect(requestCount(fresh2, whatsapp)).toBe(0);
    expect(clearances(fresh2)).toBe(1); // minted after the verified payload, not consumed by the failed command

    const retried = await create(fresh2, body(fresh2, whatsapp));
    expect(retried.status).toBe(201);
    expect(clearances(fresh2)).toBe(0);
  });

  test("no alternate path bypasses the rule: the direct RPC is gated and a clearance cannot be self-minted", async () => {
    const stranger = await createTestUser({ label: "p3d-stranger", freshAccount: true });
    authUserIds.push(stranger.authUserId);
    const direct = await stranger.client.rpc("create_registration_request", {
      p_edition_id: whatsapp.editionId,
      p_participants: [{ kind: "PROFILE", public_profile_id: stranger.publicProfileId, modality_id: whatsapp.modalityId }],
      p_legal_acceptances: [selfAcceptance(0, whatsapp.sportWaiverVersionId)],
      p_idempotency_key: null,
    });
    expect(direct.error?.code).toBe("P0001");
    expect(direct.error?.message).toBe("BUSINESS_RULE_VIOLATION");
    expect(JSON.parse(direct.error?.details ?? "{}").reason).toBe("captcha_required");

    for (const fn of ["grant_registration_captcha_clearance"]) {
      const minted = await stranger.client.rpc(fn, { p_auth_user_id: stranger.authUserId, p_edition_id: whatsapp.editionId });
      expect(minted.error).not.toBeNull();
    }
    const table = await stranger.client.from("registration_captcha_clearance").select("*");
    expect(table.error ?? table.data?.length === 0).toBeTruthy();
    expect(clearances(stranger)).toBe(0);
    expect(requestCount(stranger, whatsapp)).toBe(0);
  });

  test("an expired clearance is refused", async () => {
    const late = await createTestUser({ label: "p3d-late", freshAccount: true });
    authUserIds.push(late.authUserId);
    sql(`select private.grant_registration_captcha_clearance('${late.authUserId}', '${whatsapp.editionId}');
         update private.registration_captcha_clearance set granted_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
         where auth_user_id = '${late.authUserId}'`);
    const refused = await create(late, body(late, whatsapp));
    expect(refused.body.error.details.reason).toBe("captcha_required");
  });
});
