import "server-only";
import { revalidateTag } from "next/cache";

// ADR-001 decision 12: the only place that knows which cache tags a domain event touches.
export const cacheTags = {
  editions: "editions",
  edition: (editionId: string) => `edition:${editionId}`,
  availability: (editionId: string) => `availability:${editionId}`,
  ranking: "ranking",
  profile: (publicProfileId: string) => `profile:${publicProfileId}`,
} as const;

type EditionEvent =
  | "EditionPublished"
  | "EditionRescheduled"
  | "EditionPostponed"
  | "EditionCanceled"
  | "EditionSlugChanged"
  | "PriceOfferChanged"
  | "RoutePublished";
type AvailabilityEvent = "CapacityChanged" | "RegistrationRequestCreated" | "RegistrationRequestExpired" | "RegistrationConfirmed";
type ProfileEvent = "AvatarApproved" | "AvatarRemoved" | "AccountBanned" | "DistanceCreditChanged";
type RankingEvent = "RankingProjectionUpdated" | "RankingSnapshotCreated";

/** Master §60 invalidators. */
export type CacheInvalidationEvent =
  | { type: EditionEvent | AvailabilityEvent; editionId: string }
  | { type: ProfileEvent; publicProfileId: string }
  | { type: RankingEvent };

export type CacheInvalidationPlan = { tags: string[]; immediate: boolean };

// Stale content is never served after these: moderation/ban must disappear from public surfaces,
// and a canceled or moved Edition must not keep advertising the old state.
const IMMEDIATE = new Set<CacheInvalidationEvent["type"]>([
  "AvatarRemoved",
  "AccountBanned",
  "EditionCanceled",
  "EditionPostponed",
  "EditionRescheduled",
]);

export function cacheInvalidationPlan(event: CacheInvalidationEvent): CacheInvalidationPlan {
  const immediate = IMMEDIATE.has(event.type);
  switch (event.type) {
    case "EditionPublished":
    case "EditionRescheduled":
    case "EditionPostponed":
    case "EditionCanceled":
    case "EditionSlugChanged":
    case "PriceOfferChanged":
    case "RoutePublished":
      return { tags: [cacheTags.editions, cacheTags.edition(event.editionId)], immediate };
    case "CapacityChanged":
      return { tags: [cacheTags.edition(event.editionId), cacheTags.availability(event.editionId)], immediate };
    case "RegistrationRequestCreated":
    case "RegistrationRequestExpired":
    case "RegistrationConfirmed":
      return { tags: [cacheTags.availability(event.editionId)], immediate };
    case "AvatarApproved":
    case "AvatarRemoved":
    case "AccountBanned":
    case "DistanceCreditChanged":
      return { tags: [cacheTags.profile(event.publicProfileId), cacheTags.ranking], immediate };
    case "RankingProjectionUpdated":
    case "RankingSnapshotCreated":
      return { tags: [cacheTags.ranking], immediate };
  }
}

/** Call from route handlers or workers after the command committed. */
export function invalidateCache(events: readonly CacheInvalidationEvent[]): void {
  const tags = new Map<string, boolean>();
  for (const event of events) {
    const plan = cacheInvalidationPlan(event);
    for (const tag of plan.tags) tags.set(tag, (tags.get(tag) ?? false) || plan.immediate);
  }
  for (const [tag, immediate] of tags) revalidateTag(tag, immediate ? { expire: 0 } : "max");
}
