import "server-only";
import { revalidateTag } from "next/cache";

// ADR-001 decision 12: the only place that knows which cache tags a domain event touches.
export const cacheTags = {
  editions: "editions",
  edition: (editionId: string) => `edition:${editionId}`,
  availability: (editionId: string) => `availability:${editionId}`,
  ranking: "ranking",
  profile: (publicProfileId: string) => `profile:${publicProfileId}`,
  legal: "legal",
} as const;

type EditionEvent =
  | "EditionPublished"
  | "EditionHidden"
  | "EditionRescheduled"
  | "EditionPostponed"
  | "EditionCanceled"
  | "EditionSlugChanged"
  | "EditionUpdated"
  | "EditionContentChanged"
  | "EditionRegistrationOpened"
  | "EditionRegistrationPaused"
  | "EditionRegistrationResumed"
  | "EditionRegistrationClosed"
  | "EditionExecutionChanged"
  | "PriceOfferChanged"
  | "RoutePublished";
type AvailabilityEvent =
  | "CapacityChanged"
  | "RegistrationRequestCreated"
  | "RegistrationRequestCanceled"
  | "RegistrationRequestExpired"
  | "RegistrationConfirmed";
type ProfileEvent = "AvatarApproved" | "AvatarRemoved" | "AccountBanned" | "DistanceCreditChanged";
type RankingEvent = "RankingProjectionUpdated" | "RankingSnapshotCreated";
type LegalEvent = "LegalDocumentPublished";

/** Master §60 invalidators. */
export type CacheInvalidationEvent =
  | { type: EditionEvent | AvailabilityEvent; editionId: string }
  | { type: ProfileEvent; publicProfileId: string }
  | { type: RankingEvent }
  | { type: LegalEvent };

export type CacheInvalidationPlan = { tags: string[]; immediate: boolean };

// Stale content is never served after these: moderation/ban must disappear from public surfaces,
// a canceled/postponed/hidden/rescheduled Edition must not keep advertising the old state, and
// pausing/closing registration must stop accepting attempts against a page that still says OPEN
// (Master §60). Opening/resuming registration and ordinary content edits are not safety-critical,
// so they ride the normal ("max") revalidation semantics instead.
const IMMEDIATE = new Set<CacheInvalidationEvent["type"]>([
  "AvatarRemoved",
  "AccountBanned",
  "EditionHidden",
  "EditionCanceled",
  "EditionPostponed",
  "EditionRescheduled",
  "EditionRegistrationPaused",
  "EditionRegistrationClosed",
]);

export function cacheInvalidationPlan(event: CacheInvalidationEvent): CacheInvalidationPlan {
  const immediate = IMMEDIATE.has(event.type);
  switch (event.type) {
    case "EditionPublished":
    case "EditionHidden":
    case "EditionRescheduled":
    case "EditionPostponed":
    case "EditionCanceled":
    case "EditionSlugChanged":
    case "EditionUpdated":
    case "EditionContentChanged":
    case "EditionRegistrationOpened":
    case "EditionRegistrationPaused":
    case "EditionRegistrationResumed":
    case "EditionRegistrationClosed":
    case "EditionExecutionChanged":
    case "PriceOfferChanged":
    case "RoutePublished":
      return { tags: [cacheTags.editions, cacheTags.edition(event.editionId)], immediate };
    case "CapacityChanged":
      return {
        tags: [cacheTags.editions, cacheTags.edition(event.editionId), cacheTags.availability(event.editionId)],
        immediate,
      };
    case "RegistrationRequestCreated":
    case "RegistrationRequestCanceled":
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
    case "LegalDocumentPublished":
      return { tags: [cacheTags.legal], immediate };
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
