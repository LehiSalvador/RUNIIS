import type { APIRequestContext } from "@playwright/test";
import { e2eEnv } from "./env";

/**
 * What the target under test can offer. Seeded Editions (supabase/seeds/20_events.sql) and local SQL
 * exist only where the local Docker stack backs the target (local runs and loopback rehearsals); a
 * remote target has no events until QA fixture Editions are created there, and the suite then names
 * the open one through E2E_EVENT_SLUG. Specs that need either skip with these reasons.
 */
export const SEEDED_EDITIONS_ONLY = "relies on the seeded local Editions (supabase/seeds/20_events.sql); not present on a remote target";
export const NO_FIXTURE_EVENT = "no fixture Edition on the remote target: set E2E_EVENT_SLUG to an OPEN published QA Edition";

export function hasSeededEditions(): boolean {
  return e2eEnv().localDb;
}

/** Slug of an OPEN, available Edition to exercise: the seed locally, E2E_EVENT_SLUG remotely (else null). */
export function openEditionSlug(): string | null {
  const e2e = e2eEnv();
  if (e2e.localDb) return "demo-libre-5k-10k";
  return e2e.eventSlug;
}

/** Non-production environments are not indexable (AUD-015): robots.txt is a blanket Disallow there. */
export async function isIndexableTarget(request: APIRequestContext): Promise<boolean> {
  const body = await (await request.get("/robots.txt")).text();
  return /^Allow:\s*\/\s*$/im.test(body);
}
