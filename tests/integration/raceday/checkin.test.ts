import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { checkInScan } from "@/lib/server/domain/raceday/service";
import { cleanup, createTestStaff, createTestUser, type TestStaff, type TestUser } from "../helpers";
import { ensureGlobalLegalDocumentsPublished } from "../registration/helpers";
import { buildRacedayEdition, openCheckInWindow, registerSelfAndIssueToken } from "./helpers";

// Master §85 "must prove": two stations racing the same token settle to exactly one VALID and one
// ALREADY_CHECKED_IN, and a burst of scans of the same token never produces a second VALID. Real
// parallel RPC calls against real Postgres (the pass row FOR UPDATE lock), not a single-connection
// simulation.
describe("T40 Race Day check-in concurrency (Master §85, SEC-031) integration", () => {
  let admin: TestStaff;
  let stationA: TestStaff;
  let stationB: TestStaff;
  const users: TestUser[] = [];

  beforeAll(async () => {
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
    stationA = await createTestStaff("CHECKIN", "GLOBAL");
    stationB = await createTestStaff("CHECKIN", "GLOBAL");
  }, 30_000);

  afterAll(async () => {
    await cleanup([admin.authUserId, stationA.authUserId, stationB.authUserId, ...users.map((u) => u.authUserId)]);
  });

  async function trackedBuyer(label: string): Promise<TestUser> {
    const buyer = await createTestUser({ label, dob: "1990-01-01" });
    users.push(buyer);
    return buyer;
  }

  test("two stations scanning the same token concurrently: exactly one VALID and one ALREADY_CHECKED_IN", async () => {
    const edition = await buildRacedayEdition(admin.client);
    const buyer = await trackedBuyer("checkin-race");
    const { token } = await registerSelfAndIssueToken(buyer, edition);
    await openCheckInWindow(admin.client, edition.editionId);

    const [a, b] = await Promise.all([
      checkInScan(stationA.client, edition.editionId, token, "S1"),
      checkInScan(stationB.client, edition.editionId, token, "S2"),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_CHECKED_IN", "VALID"]);
  }, 30_000);

  test("100 concurrent scans of the same token yield exactly one VALID (no double check-in under load)", async () => {
    const edition = await buildRacedayEdition(admin.client);
    const buyer = await trackedBuyer("checkin-burst");
    const { token } = await registerSelfAndIssueToken(buyer, edition);
    await openCheckInWindow(admin.client, edition.editionId);

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => checkInScan(stationA.client, edition.editionId, token, `S${i % 3}`)),
    );

    const validCount = results.filter((r) => r.outcome === "VALID").length;
    const alreadyCount = results.filter((r) => r.outcome === "ALREADY_CHECKED_IN").length;
    expect(validCount).toBe(1);
    expect(alreadyCount).toBe(99);
  }, 60_000);

  test("VALID then re-scan is ALREADY_CHECKED_IN, and the participant view carries the display name (§174 response shape)", async () => {
    const edition = await buildRacedayEdition(admin.client);
    const buyer = await trackedBuyer("checkin-shape");
    const { token } = await registerSelfAndIssueToken(buyer, edition);
    await openCheckInWindow(admin.client, edition.editionId);

    const first = await checkInScan(stationA.client, edition.editionId, token, "S1");
    expect(first.outcome).toBe("VALID");
    expect(first.participant?.display_name).toBeTruthy();
    expect(first.participant?.registration_status).toBe("CONFIRMED");

    const second = await checkInScan(stationA.client, edition.editionId, token, "S1");
    expect(second.outcome).toBe("ALREADY_CHECKED_IN");
  }, 30_000);
});
