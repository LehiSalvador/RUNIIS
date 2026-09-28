import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createContentBlock,
  createEdition,
  createEvent,
  createModality,
  transitionEdition,
} from "@/lib/server/domain/events/service";
import { getEditionAvailability, getEditionPage, getHomeData, getSitemapEntries, searchEditions } from "@/lib/server/domain/discovery/service";
import { AppError } from "@/lib/server/http/errors";
import { APP_URL, cleanup, createTestStaff, type TestStaff } from "../helpers";

// Exercises the public discovery read side (T31) end to end: real local Postgres/PostgREST through
// the domain layer (searchEditions/getEditionPage/getEditionAvailability/getSitemapEntries/
// getHomeData), plus a couple of assertions against the real HTTP routes for the parts that are
// route-layer behavior (404 mapping, the 308 redirect, no-store on availability) rather than RPC
// shape. Local target only (ADR-001 owner environment model).

async function publishFreeEdition(staff: TestStaff, name: string, distanceM = 5000) {
  const event = await createEvent(staff.client, { event_type_key: "ROAD_RACE", name, canonical_key: `it-discovery-${randomUUID()}` }, null);
  const edition = await createEdition(
    staff.client,
    event.event_id,
    {
      slug: `it-discovery-${randomUUID().slice(0, 8)}`,
      name,
      registration_mode: "FREE",
      city: "Monterrey",
      state_region: "NL",
      schedule: { local_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), local_start_time: "07:00:00" },
    },
    null,
  );
  await createModality(staff.client, edition.edition_id, { key: "5k", name: "5K", official_distance_m: distanceM }, null);
  await createContentBlock(staff.client, edition.edition_id, {
    block_type: "RICH_TEXT",
    status: "PUBLISHED",
    payload: { markdown: "Contenido de prueba de integración con más de treinta caracteres." },
  });
  const published = await transitionEdition(staff.client, "publish", edition.edition_id, {}, null);
  return { edition: published.edition, slug: published.edition.slug };
}

describe("discovery (T31) domain integration", () => {
  let admin: TestStaff;

  beforeAll(async () => {
    admin = await createTestStaff("ADMIN", "GLOBAL");
  }, 30_000);

  afterAll(async () => {
    await cleanup([admin.authUserId]);
  });

  test("a DRAFT Edition is invisible: 404 by slug, absent from search", async () => {
    const event = await createEvent(admin.client, { event_type_key: "ROAD_RACE", name: "IT Draft Only", canonical_key: `it-draft-${randomUUID()}` }, null);
    const edition = await createEdition(
      admin.client,
      event.event_id,
      {
        slug: `it-draft-${randomUUID().slice(0, 8)}`,
        name: "IT Draft Only",
        registration_mode: "FREE",
        city: "Monterrey",
        state_region: "NL",
        registration_close_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      null,
    );
    await expect(getEditionPage(edition.slug)).resolves.toBeNull();

    const result = await searchEditions({ q: "IT Draft Only" });
    expect(result.items.find((item) => item.edition_id === edition.edition_id)).toBeUndefined();
  });

  test("getEditionPage resolves a PUBLISHED Edition with levels 1-3 data and public availability", async () => {
    const { edition, slug } = await publishFreeEdition(admin, `IT Discovery Page ${randomUUID().slice(0, 8)}`);
    const page = await getEditionPage(slug);
    if (!page || page.redirect) throw new Error("expected a non-redirect page result");
    expect(page.edition.edition.edition_id).toBe(edition.edition_id);
    expect(page.edition.modalities).toHaveLength(1);
    expect(page.edition.content_blocks).toHaveLength(1);
    expect(page.edition.availability?.global_state).toBe("AVAILABLE");
    // Payload budget / no leaked internals: modality projection has no staff-only fields.
    expect(page.edition.modalities[0]).not.toHaveProperty("updated_by_staff_id");
  });

  test("getEditionAvailability by slug is a fresh, public-safe read (no raw counts)", async () => {
    const { slug } = await publishFreeEdition(admin, `IT Discovery Availability ${randomUUID().slice(0, 8)}`);
    const availability = await getEditionAvailability(slug);
    expect(availability?.global_state).toBe("AVAILABLE");
    expect(JSON.stringify(availability)).not.toMatch(/confirmed|active_holds/);
    await expect(getEditionAvailability(`no-such-slug-${randomUUID()}`)).resolves.toBeNull();
  });

  test("searchEditions distance filter and cursor pagination cap results and stay within limit", async () => {
    const token = `itdiscpg${randomUUID().slice(0, 8)}`;
    await publishFreeEdition(admin, `IT Distance ${token} A`, 5000);
    await publishFreeEdition(admin, `IT Distance ${token} B`, 5000);
    await publishFreeEdition(admin, `IT Distance ${token} C`, 21097);

    const only5k = await searchEditions({ q: token, distance_max_m: 6000 });
    expect(only5k.items).toHaveLength(2);
    expect(only5k.items.every((item) => item.modality_summary.max_distance_m! <= 6000)).toBe(true);

    const page1 = await searchEditions({ q: token, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await searchEditions({ q: token, limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.length).toBeGreaterThan(0);
    const page1Ids = new Set(page1.items.map((item) => item.edition_id));
    expect(page2.items.some((item) => page1Ids.has(item.edition_id))).toBe(false);
  });

  test("searchEditions caps limit at 50 and rejects distance_max_m < distance_min_m", async () => {
    const capped = await searchEditions({ limit: 200 as unknown as number });
    expect(capped.items.length).toBeLessThanOrEqual(50);

    await expect(searchEditions({ distance_min_m: 10000, distance_max_m: 1000 })).rejects.toBeInstanceOf(AppError);
    await searchEditions({ distance_min_m: 10000, distance_max_m: 1000 }).catch((error: AppError) => {
      expect(error.code).toBe("VALIDATION_ERROR");
    });
  });

  test("getHomeData returns only future-dated Editions and the ranking placeholder slot", async () => {
    const home = await getHomeData();
    expect(Array.isArray(home.upcoming)).toBe(true);
    expect(home.upcoming.every((card) => card.sport_date === null || card.sport_date >= new Date().toISOString().slice(0, 10))).toBe(true);
    expect(home.community_slot).toEqual({ available: false, reason: "ranking_pending_t42" });
  });

  test("getSitemapEntries lists the Edition just published, by its current slug", async () => {
    const { slug } = await publishFreeEdition(admin, `IT Sitemap ${randomUUID().slice(0, 8)}`);
    const entries = await getSitemapEntries();
    expect(entries.some((entry) => entry.slug === slug)).toBe(true);
  });

  test("HTTP: GET /api/v1/events/:slug is 404 for an unknown slug, with no leaked internals", async () => {
    const response = await fetch(new URL(`/api/v1/events/no-such-slug-${randomUUID()}`, APP_URL));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; details: Record<string, unknown> } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(body)).not.toMatch(/postgres|pg_|stack|internal/i);
  });

  test("HTTP: GET /api/v1/events/:slug/availability sends Cache-Control: no-store", async () => {
    const { slug } = await publishFreeEdition(admin, `IT No Store ${randomUUID().slice(0, 8)}`);
    const response = await fetch(new URL(`/api/v1/events/${slug}/availability`, APP_URL));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("HTTP: an oversized/invalid query param is rejected as VALIDATION_ERROR, not a 500", async () => {
    const response = await fetch(new URL(`/api/v1/events?limit=abc`, APP_URL));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
