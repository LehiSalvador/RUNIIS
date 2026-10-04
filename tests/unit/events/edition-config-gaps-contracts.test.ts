import { describe, expect, test } from "vitest";
import {
  createMediaAssetBodySchema,
  mediaAssetListQuerySchema,
  mediaAssetListSchema,
  scheduleRevisionHistoryQuerySchema,
  scheduleRevisionHistorySchema,
  updateLocationBodySchema,
  updateScheduleItemBodySchema,
} from "@/lib/server/domain/events/contracts";
import { isPublicMediaKey, publicMediaUrl } from "@/lib/shared/media-url";

// P3-M contract tests: nullable PATCH bodies (clear optional values, keep required ones non-null), the schedule revision history and
// media reference schemas. Behaviour against the database lives in supabase/tests/database/740 and
// tests/integration/events/edition-config-gaps.test.ts.

const guid = "7f0c1a52-3b6e-4c1d-9a55-0b9f4d6a1e10";

describe("nullable location PATCH (P3-AC-06)", () => {
  test.each(["address_line", "city", "state_region", "country_code", "latitude", "longitude"])("%s can be cleared with null", (field) => {
    expect(updateLocationBodySchema.parse({ [field]: null })).toEqual({ [field]: null });
  });

  test("a coordinate pair is cleared together", () => {
    expect(updateLocationBodySchema.parse({ latitude: null, longitude: null })).toEqual({ latitude: null, longitude: null });
  });

  test.each(["location_type", "name", "is_primary", "sort_order"])("required %s still refuses null", (field) => {
    expect(updateLocationBodySchema.safeParse({ [field]: null }).success).toBe(false);
  });

  test("absent means unchanged and an empty string is still invalid", () => {
    expect(updateLocationBodySchema.parse({})).toEqual({});
    expect(updateLocationBodySchema.safeParse({ address_line: "" }).success).toBe(false);
    expect(updateLocationBodySchema.safeParse({ latitude: 91 }).success).toBe(false);
    expect(updateLocationBodySchema.safeParse({ unknown: null }).success).toBe(false);
  });
});

describe("nullable agenda PATCH (P3-AC-06)", () => {
  test.each(["description", "local_start_time", "local_end_time", "modality_id", "location_id"])("%s can be cleared with null", (field) => {
    expect(updateScheduleItemBodySchema.parse({ [field]: null })).toEqual({ [field]: null });
  });

  test.each(["title", "local_date", "sort_order", "status"])("required %s still refuses null", (field) => {
    expect(updateScheduleItemBodySchema.safeParse({ [field]: null }).success).toBe(false);
  });

  test("values still validate and absent means unchanged", () => {
    expect(updateScheduleItemBodySchema.parse({})).toEqual({});
    expect(updateScheduleItemBodySchema.parse({ local_start_time: "08:30", location_id: guid })).toEqual({ local_start_time: "08:30", location_id: guid });
    expect(updateScheduleItemBodySchema.safeParse({ local_start_time: "8:30" }).success).toBe(false);
    expect(updateScheduleItemBodySchema.safeParse({ location_id: "nope" }).success).toBe(false);
  });
});

describe("schedule revision history schemas", () => {
  const item = {
    edition_schedule_revision_id: guid,
    revision: 2,
    schedule_state: "DATE_TIME_CONFIRMED",
    local_date: "2027-01-10",
    local_start_time: "07:00:00",
    local_end_time: null,
    timezone: "America/Monterrey",
    effective_start_at: "2027-01-10T13:00:00+00:00",
    effective_end_at: null,
    reason: "Cambio de hora",
    created_at: "2026-10-03T12:00:00.123456+00:00",
    superseded_at: null,
    is_current: true,
    created_by_staff_id: guid,
  };

  test("a page parses; an unknown key fails closed (nothing else about the actor leaks)", () => {
    const page = { items: [item], total: 2, next_cursor: { revision: 2 } };
    expect(scheduleRevisionHistorySchema.parse(page)).toEqual(page);
    expect(scheduleRevisionHistorySchema.safeParse({ items: [{ ...item, staff_email: "x@y.z" }], total: 1, next_cursor: null }).success).toBe(false);
  });

  test("query is strict with a 1..100 limit", () => {
    expect(scheduleRevisionHistoryQuerySchema.parse({ limit: "50", cursor: "abc" })).toEqual({ limit: 50, cursor: "abc" });
    expect(scheduleRevisionHistoryQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(scheduleRevisionHistoryQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(scheduleRevisionHistoryQuerySchema.safeParse({ status: "x" }).success).toBe(false);
  });
});

describe("media asset reference schemas (Master 52, no upload)", () => {
  const body = { media_type: "IMAGE", storage_object_key: "runiis/2027/start-line", alt_text: "Linea de salida" };

  test("a reference to an existing storage key parses", () => {
    expect(createMediaAssetBodySchema.parse(body)).toEqual(body);
    expect(createMediaAssetBodySchema.parse({ ...body, status: "PUBLISHED", sort_order: 3, focal_point: { x: 0.25, y: 1 } })).toMatchObject({
      status: "PUBLISHED",
      focal_point: { x: 0.25, y: 1 },
    });
    expect(createMediaAssetBodySchema.parse({ ...body, focal_point: null }).focal_point).toBeNull();
  });

  test.each([
    "https://example.com/a.png",
    "http://res.cloudinary.com/x/a.png",
    "//cdn.example.com/a.png",
    "../secret",
    "a/../b",
    "/abs/path",
    "has space",
    "javascript:alert(1)",
    "",
  ])("storage_object_key %j is refused (only a plain public id the delivery URL can serve)", (storage_object_key) => {
    expect(createMediaAssetBodySchema.safeParse({ ...body, storage_object_key }).success).toBe(false);
  });

  test("everything the delivery builder can serve is accepted; everything it cannot is refused", () => {
    for (const key of ["a", "runiis/2027/foto-1.jpg", "A_b-c.d/e"]) {
      expect(isPublicMediaKey(key)).toBe(true);
      expect(publicMediaUrl(key, { width: 800 }, "demo")).not.toBeNull();
    }
    for (const key of ["https://x/y", "a/../b", "-lead", ""]) {
      expect(isPublicMediaKey(key)).toBe(false);
      expect(publicMediaUrl(key, { width: 800 }, "demo")).toBeNull();
    }
  });

  test("only IMAGE, creatable as PENDING or PUBLISHED, bounded alt text and focal point, unknown fields refused", () => {
    expect(createMediaAssetBodySchema.safeParse({ ...body, media_type: "VIDEO" }).success).toBe(false);
    expect(createMediaAssetBodySchema.safeParse({ ...body, status: "ARCHIVED" }).success).toBe(false);
    expect(createMediaAssetBodySchema.safeParse({ ...body, alt_text: "" }).success).toBe(false);
    expect(createMediaAssetBodySchema.safeParse({ ...body, alt_text: "x".repeat(301) }).success).toBe(false);
    expect(createMediaAssetBodySchema.safeParse({ ...body, focal_point: { x: 1.1, y: 0 } }).success).toBe(false);
    expect(createMediaAssetBodySchema.safeParse({ ...body, focal_point: { x: 0.5 } }).success).toBe(false);
    expect(createMediaAssetBodySchema.safeParse({ ...body, edition_id: guid }).success).toBe(false);
    expect(createMediaAssetBodySchema.safeParse({ ...body, sort_order: -1 }).success).toBe(false);
  });

  test("list schema and query", () => {
    const asset = {
      event_media_asset_id: guid,
      edition_id: guid,
      media_type: "IMAGE",
      storage_object_key: "runiis/2027/start-line",
      alt_text: "Linea de salida",
      status: "PENDING",
      sort_order: 1,
      focal_point: null,
      created_at: "2026-10-03T12:00:00+00:00",
      updated_at: "2026-10-03T12:00:00+00:00",
    };
    const page = { items: [asset], next_cursor: { sort_order: 1, event_media_asset_id: guid } };
    expect(mediaAssetListSchema.parse(page)).toEqual(page);
    expect(mediaAssetListQuerySchema.parse({ status: "PUBLISHED", limit: "10" })).toEqual({ status: "PUBLISHED", limit: 10 });
    expect(mediaAssetListQuerySchema.safeParse({ status: "DRAFT" }).success).toBe(false);
  });
});
