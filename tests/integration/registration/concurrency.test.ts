import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AppError } from "@/lib/server/http/errors";
import { createRegistrationRequest } from "@/lib/server/domain/registration/service";
import { cleanup, createTestStaff, createTestUser, type TestStaff, type TestUser } from "../helpers";
import { buildEdition, ensureGlobalLegalDocumentsPublished, selfAcceptance } from "./helpers";

// CAP-001: 20 concurrent clients racing for the last 5 spots of a Modality must never oversell.
// Real parallel RPC calls against real Postgres (Edition -> ModalityCapacity row lock order, ADR-001
// §3), not a single-connection simulation: exactly `capacity` requests succeed, the rest are rejected.
describe("CAP-001 registration capacity concurrency (T34) integration", () => {
  let admin: TestStaff;
  const users: TestUser[] = [];

  beforeAll(async () => {
    ensureGlobalLegalDocumentsPublished();
    admin = await createTestStaff("ADMIN", "GLOBAL");
  }, 30_000);

  afterAll(async () => {
    await cleanup([admin.authUserId, ...users.map((u) => u.authUserId)]);
  });

  /** Creates `count` real users, tracking each in `users` for cleanup as soon as it settles -- a
   * `Promise.all` that rejects partway through would otherwise orphan the users created before the
   * rejection (they never reach an array pushed only after the whole batch resolves). */
  async function createTrackedUsers(labelPrefix: string, count: number): Promise<TestUser[]> {
    const created = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const user = await createTestUser({ label: `${labelPrefix}-${i}`, dob: "1990-01-01" });
        users.push(user);
        return user;
      }),
    );
    return created;
  }

  test("modality capacity: exactly `capacity` of 20 concurrent EXTERNAL_WHATSAPP requests succeed, the rest get CAPACITY_UNAVAILABLE", async () => {
    const CAPACITY = 5;
    const CLIENTS = 20;
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: CAPACITY });

    const buyers = await createTrackedUsers("cap001", CLIENTS);

    const outcomes = await Promise.allSettled(
      buyers.map((buyer) =>
        createRegistrationRequest(
          buyer.client,
          {
            edition_id: edition.editionId,
            participants: [{ kind: "PROFILE", public_profile_id: buyer.publicProfileId!, modality_id: edition.modalityId }],
            legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
          },
          null,
        ),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");

    expect(succeeded).toHaveLength(CAPACITY);
    expect(failed).toHaveLength(CLIENTS - CAPACITY);
    for (const rejection of failed) {
      expect(rejection.reason).toBeInstanceOf(AppError);
      expect((rejection.reason as AppError).code).toBe("CAPACITY_UNAVAILABLE");
    }
  }, 60_000);

  // Single Modality: proves global_capacity is enforced under real concurrency. Cross-modality
  // aggregation (the same global_capacity binding two different Modalities) is proved synchronously
  // by pgTAP 400_registration_requests.test.sql's E3 fixture; not re-proved here under concurrency.
  test("global capacity binds under concurrency (single Modality, unbound modality-level capacity)", async () => {
    const GLOBAL_CAPACITY = 4;
    const CLIENTS = 12;
    const edition = await buildEdition(admin.client, { mode: "EXTERNAL_WHATSAPP", modalityCapacity: 1000, globalCapacity: GLOBAL_CAPACITY });

    const buyers = await createTrackedUsers("cap001g", CLIENTS);

    const outcomes = await Promise.allSettled(
      buyers.map((buyer) =>
        createRegistrationRequest(
          buyer.client,
          {
            edition_id: edition.editionId,
            participants: [{ kind: "PROFILE", public_profile_id: buyer.publicProfileId!, modality_id: edition.modalityId }],
            legal_acceptances: [selfAcceptance(0, edition.sportWaiverVersionId)],
          },
          null,
        ),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(succeeded).toHaveLength(GLOBAL_CAPACITY);
    expect(failed).toHaveLength(CLIENTS - GLOBAL_CAPACITY);
    for (const rejection of failed) {
      expect((rejection.reason as AppError).code).toBe("GLOBAL_CAPACITY_UNAVAILABLE");
    }
  }, 60_000);
});
