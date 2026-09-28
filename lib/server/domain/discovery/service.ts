import "server-only";
import type { z } from "zod";
import { callRpc } from "@/lib/server/rpc";
import { createAnonClient } from "@/lib/server/supabase/clients";
import {
  editionPageResultSchema,
  homeDataSchema,
  searchEditionsQuerySchema,
  searchEditionsResultSchema,
  sitemapEntriesSchema,
  publicAvailabilitySchema,
} from "./contracts";

// Thin RPC layer over supabase/migrations/20260928110000_310_discovery_queries.sql (public.*).
// Cookie-free anon client throughout (ADR-001 decision 12): every function below is safe to call
// from a static/ISR page, a route handler or a plain test — none of them touch cookies or the
// request/render context.
//
// Deliberately NOT wrapped in `unstable_cache` here: that API throws ("incrementalCache missing")
// outside an active Next.js request/render context, which would make these functions unusable from
// route handlers driven by tests and from tests calling the domain layer directly (verified: see
// tests/integration/discovery). Caching is a page/route rendering decision, not a data-access one —
// the frontend wraps whichever of these calls it wants cached (e.g. `unstable_cache(searchEditions,
// [...], { tags: [cacheTags.editions] })` inside a server component, or `export const revalidate` /
// a `"use cache"` boundary on the page) using `cacheTags.editions` (search/home/page/sitemap) and
// the Master §60 invalidators already wired in lib/server/cache/invalidation.ts. `getEditionPage`
// cannot be tagged per-Edition ahead of time (the id is only known after resolving the slug inside
// the call), so it only ever qualifies for the broad `editions` tag.
// `getEditionAvailability` must NEVER be wrapped in any cache (Master §60: availability reads fresh,
// SEC-051/052) — call it at request time only.

// Partial, not the raw zod output type: zod's `.transform()` on an optional field (used for the
// `type`/`price`/`registration_open` multi-value/boolean params) turns it into an always-present
// `T | undefined` property rather than an optional key, which would force every caller — including
// a server component building this object field by field — to spell out every filter as `undefined`.
export type SearchEditionsParams = Partial<z.output<typeof searchEditionsQuerySchema>>;
export type SearchEditionsResult = { items: z.output<typeof searchEditionsResultSchema>["items"]; nextCursor: string | null };

function decodeSearchCursor(cursor: string | undefined): { bucket: number | null; sortNum: number | null; editionId: string | null } {
  if (!cursor) return { bucket: null, sortNum: null, editionId: null };
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded && typeof decoded === "object" && "bucket" in decoded && "sort_num" in decoded && "edition_id" in decoded) {
      const { bucket, sort_num, edition_id } = decoded as { bucket: unknown; sort_num: unknown; edition_id: unknown };
      if (typeof bucket === "number" && typeof sort_num === "number" && typeof edition_id === "string") {
        return { bucket, sortNum: sort_num, editionId: edition_id };
      }
    }
  } catch {
    // falls through to first page, same convention as the admin edition list cursor
  }
  return { bucket: null, sortNum: null, editionId: null };
}

function encodeSearchCursor(next: { bucket: unknown; sort_num: unknown; edition_id: unknown } | null | undefined): string | null {
  if (!next) return null;
  return Buffer.from(JSON.stringify({ bucket: next.bucket, sort_num: next.sort_num, edition_id: next.edition_id }), "utf8").toString("base64url");
}

/** GET /api/v1/events (Master §54-56, §165). See the module doc comment for the caching split. */
export async function searchEditions(params: SearchEditionsParams): Promise<SearchEditionsResult> {
  const after = decodeSearchCursor(params.cursor);
  const result = await callRpc(
    createAnonClient(),
    "search_editions",
    {
      p_q: params.q ?? null,
      p_type: params.type ?? null,
      p_date_from: params.date_from ?? null,
      p_date_to: params.date_to ?? null,
      p_distance_min_m: params.distance_min_m ?? null,
      p_distance_max_m: params.distance_max_m ?? null,
      p_location: params.location ?? null,
      p_price: params.price ?? null,
      p_registration_open: params.registration_open ?? null,
      p_cursor_bucket: after.bucket,
      p_cursor_sort_num: after.sortNum,
      p_cursor_id: after.editionId,
      p_limit: params.limit ?? 20,
    },
    searchEditionsResultSchema,
  );
  return { items: result.items, nextCursor: encodeSearchCursor(result.next_cursor) };
}

/** Home data (Master §53): próximas carreras + the ranking placeholder slot (T42 fills it later). */
export async function getHomeData() {
  return callRpc(createAnonClient(), "get_home_data", {}, homeDataSchema);
}

/**
 * Event page data (Master §58, levels 1-3). NULL = unknown or unpublished slug (caller: 404).
 * `{redirect: true, slug}` = a historical slug (Master §59) — the caller issues the permanent
 * redirect to `/eventos/<slug>`, never re-fetches here.
 */
export async function getEditionPage(slug: string) {
  return callRpc(createAnonClient(), "get_edition_page", { p_slug: slug }, editionPageResultSchema);
}

/** Sitemap entries (Master §59): every PUBLISHED Edition's current slug. */
export async function getSitemapEntries() {
  return callRpc(createAnonClient(), "get_sitemap_entries", {}, sitemapEntriesSchema);
}

/**
 * Fresh availability by slug (Master §60: "availability es dinámica... lectura server-side fresca").
 * NULL = unknown or unpublished slug (caller: 404), matching getEditionPage's contract. Never cache
 * this call, at any layer.
 */
export async function getEditionAvailability(slug: string): Promise<z.output<typeof publicAvailabilitySchema>> {
  return callRpc(createAnonClient(), "get_edition_page_availability", { p_slug: slug }, publicAvailabilitySchema);
}
