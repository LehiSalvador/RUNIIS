import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { recordKitPickup } from "@/lib/server/domain/raceday/service";
import { cleanup, createTestStaff, createTestUser, type TestStaff, type TestUser } from "../helpers";
import { ensureGlobalLegalDocumentsPublished } from "../registration/helpers";
import { queryValue } from "../helpers";
import { buildKitFixture, buildRacedayEdition, registerSelfAndIssueToken } from "./helpers";

// Master §89 "must prove": a duplicate kit pickup scan never delivers twice, even under real
// concurrent requests racing the same allocation row.
describe("T40 Kit Center pickup concurrency (Master §89) integration", () => {
  let admin: TestStaff;
  let operator: TestStaff;
  const users: TestUser[] = [];

  beforeAll(async () => {
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    operator = await createTestStaff("OPERATOR", "GLOBAL");
  }, 30_000);

  afterAll(async () => {
    await cleanup([admin.authUserId, operator.authUserId, ...users.map((u) => u.authUserId)]);
  });

  test("two concurrent pickup scans of the same pass deliver exactly once", async () => {
    const edition = await buildRacedayEdition(admin.client);
    const buyer = await createTestUser({ label: "kit-race", dob: "1990-01-01" });
    users.push(buyer);
    const { registrationId, token } = await registerSelfAndIssueToken(buyer, edition);
    const kit = buildKitFixture(edition.editionId, registrationId, null);

    const [a, b] = await Promise.all([
      recordKitPickup(operator.client, {
        editionId: edition.editionId,
        kitDefinitionId: kit.kitDefinitionId,
        credentialToken: token,
        stationKey: "K1",
        thirdParty: false,
        thirdPartyReason: null,
        idempotencyKey: null,
      }),
      recordKitPickup(operator.client, {
        editionId: edition.editionId,
        kitDefinitionId: kit.kitDefinitionId,
        credentialToken: token,
        stationKey: "K2",
        thirdParty: false,
        thirdPartyReason: null,
        idempotencyKey: null,
      }),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_CHECKED_IN", "VALID"]);

    const deliveredCount = Number(
      queryValue(`select count(*)::int from app.kit_pickup where registration_id = '${registrationId}' and status = 'DELIVERED'`),
    );
    expect(deliveredCount).toBe(1);
  }, 30_000);
});
