import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag }));

import { cacheInvalidationPlan, invalidateCache, type CacheInvalidationEvent } from "@/lib/server/cache/invalidation";

const E = "11111111-1111-4111-8111-111111111111";
const P = "runner-public-id";

beforeEach(() => revalidateTag.mockReset());

describe("cacheInvalidationPlan (Master §60)", () => {
  it.each<[CacheInvalidationEvent, string[], boolean]>([
    [{ type: "EditionPublished", editionId: E }, ["editions", `edition:${E}`], false],
    [{ type: "EditionHidden", editionId: E }, ["editions", `edition:${E}`], true],
    [{ type: "EditionRescheduled", editionId: E }, ["editions", `edition:${E}`], true],
    [{ type: "EditionPostponed", editionId: E }, ["editions", `edition:${E}`], true],
    [{ type: "EditionCanceled", editionId: E }, ["editions", `edition:${E}`], true],
    [{ type: "EditionSlugChanged", editionId: E }, ["editions", `edition:${E}`], false],
    [{ type: "PriceOfferChanged", editionId: E }, ["editions", `edition:${E}`], false],
    [{ type: "CapacityChanged", editionId: E }, [`edition:${E}`, `availability:${E}`], false],
    [{ type: "RegistrationRequestCreated", editionId: E }, [`availability:${E}`], false],
    [{ type: "RegistrationRequestExpired", editionId: E }, [`availability:${E}`], false],
    [{ type: "RegistrationConfirmed", editionId: E }, [`availability:${E}`], false],
    [{ type: "AvatarApproved", publicProfileId: P }, [`profile:${P}`, "ranking"], false],
    [{ type: "AvatarRemoved", publicProfileId: P }, [`profile:${P}`, "ranking"], true],
    [{ type: "AccountBanned", publicProfileId: P }, [`profile:${P}`, "ranking"], true],
    [{ type: "DistanceCreditChanged", publicProfileId: P }, [`profile:${P}`, "ranking"], false],
    [{ type: "RankingProjectionUpdated" }, ["ranking"], false],
    [{ type: "RankingSnapshotCreated" }, ["ranking"], false],
  ])("%o", (event, tags, immediate) => {
    expect(cacheInvalidationPlan(event)).toEqual({ tags, immediate });
  });
});

describe("invalidateCache", () => {
  it("revalidates each tag once, preferring immediate expiry when any event needs it", () => {
    invalidateCache([
      { type: "AvatarApproved", publicProfileId: P },
      { type: "AccountBanned", publicProfileId: P },
      { type: "RankingSnapshotCreated" },
      { type: "EditionPublished", editionId: E },
    ]);
    expect(revalidateTag.mock.calls).toEqual([
      [`profile:${P}`, { expire: 0 }],
      ["ranking", { expire: 0 }],
      ["editions", "max"],
      [`edition:${E}`, "max"],
    ]);
  });

  it("does nothing for an empty batch", () => {
    invalidateCache([]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
