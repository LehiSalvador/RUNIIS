import { afterEach, describe, expect, test } from "vitest";
import { buildEditionSeo, type EditionPage } from "@/lib/server/domain/discovery/seo";

// Master §59: title/description/canonical/OG image/JSON-LD/breadcrumbs. §29/§58: never invent a
// time — startDate is date-only when the schedule's time is pending, omitted with no known date.

function basePage(overrides: Partial<EditionPage["edition"]["schedule"]> = {}): EditionPage {
  return {
    edition: {
      edition_id: "11111111-1111-4111-8111-111111111111",
      event_id: "22222222-2222-4222-8222-222222222222",
      slug: "carrera-demo",
      name: "Carrera Demo",
      publication_state: "PUBLISHED",
      registration_state: "OPEN",
      execution_state: "SCHEDULED",
      closure_state: "OPEN",
      registration_mode: "FREE",
      timezone: "America/Monterrey",
      registration_open_at: null,
      registration_close_at: "2026-12-01T00:00:00Z",
      global_capacity: null,
      city: "Monterrey",
      state_region: "NL",
      country_code: "MX",
      primary_location_id: null,
      whatsapp_phone_e164: null,
      is_benefit_event: false,
      published_at: "2026-09-01T00:00:00Z",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      schedule: {
        edition_schedule_revision_id: "33333333-3333-4333-8333-333333333333",
        revision: 1,
        schedule_state: "DATE_TIME_CONFIRMED",
        local_date: "2026-12-15",
        local_start_time: "07:00:00",
        local_end_time: null,
        timezone: "America/Monterrey",
        effective_start_at: "2026-12-15T13:00:00Z",
        effective_end_at: null,
        created_at: "2026-09-01T00:00:00Z",
        ...overrides,
      },
    },
    event: {
      event_id: "22222222-2222-4222-8222-222222222222",
      name: "Carrera Demo Event",
      canonical_key: "carrera-demo-event",
      status: "ACTIVE",
      event_type_key: "ROAD_RACE",
      event_type_name: "Road Race",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
    availability: null,
    is_past: false,
    modalities: [],
    categories: [],
    locations: [],
    agenda: [],
    content_blocks: [],
    kits: [],
    media: [],
  } as unknown as EditionPage;
}

describe("buildEditionSeo", () => {
  test("canonical and breadcrumbs are built from the base URL and slug", () => {
    const seo = buildEditionSeo(basePage(), "https://runiis.com");
    expect(seo.canonical).toBe("https://runiis.com/eventos/carrera-demo");
    expect(seo.breadcrumbs.map((b) => b.url)).toEqual(["https://runiis.com/", "https://runiis.com/eventos", "https://runiis.com/eventos/carrera-demo"]);
  });

  test("startDate uses the confirmed effective_start_at when the time is known", () => {
    const seo = buildEditionSeo(basePage(), "https://runiis.com");
    expect(seo.jsonLd.startDate).toBe("2026-12-15T13:00:00Z");
  });

  test("startDate is date-only when the schedule's time is pending (never invents 00:00)", () => {
    const seo = buildEditionSeo(
      basePage({ schedule_state: "DATE_CONFIRMED_TIME_PENDING", local_start_time: null, effective_start_at: null }),
      "https://runiis.com",
    );
    expect(seo.jsonLd.startDate).toBe("2026-12-15");
  });

  test("startDate is omitted entirely when there is no known date", () => {
    const seo = buildEditionSeo(
      basePage({ schedule_state: "POSTPONED_NO_NEW_DATE", local_date: null, local_start_time: null, effective_start_at: null }),
      "https://runiis.com",
    );
    expect(seo.jsonLd).not.toHaveProperty("startDate");
  });

  test("eventStatus maps execution_state to schema.org's EventStatusType", () => {
    const canceled = basePage();
    canceled.edition.execution_state = "CANCELED";
    expect(buildEditionSeo(canceled, "https://runiis.com").jsonLd.eventStatus).toBe("https://schema.org/EventCancelled");
  });

  test("description falls back to a generated sentence when there is no published RICH_TEXT/CUSTOM_SECTION block", () => {
    const seo = buildEditionSeo(basePage(), "https://runiis.com");
    expect(seo.description).toContain("Carrera Demo");
    expect(seo.description).toContain("Monterrey");
  });

  test("ogImage is null when no PUBLISHED media asset exists", () => {
    expect(buildEditionSeo(basePage(), "https://runiis.com").ogImage).toBeNull();
  });

  describe("media (F1 follow-up: delivery URL, never the raw storage key)", () => {
    const originalCloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    afterEach(() => {
      if (originalCloud === undefined) delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      else process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = originalCloud;
    });

    function pageWithMedia(): EditionPage {
      const page = basePage();
      page.media = [
        {
          event_media_asset_id: "44444444-4444-4444-8444-444444444444",
          storage_object_key: "runiis/editions/carrera-demo/cover",
          alt_text: "Cover",
          media_type: "IMAGE",
          sort_order: 1,
          focal_point: null,
        },
      ] as unknown as EditionPage["media"];
      return page;
    }

    test("ogImage and jsonLd.image are a Cloudinary delivery URL, never the raw storage_object_key", () => {
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "runiis-test-cloud";
      const seo = buildEditionSeo(pageWithMedia(), "https://runiis.com");
      expect(seo.ogImage).toBe(
        "https://res.cloudinary.com/runiis-test-cloud/image/upload/f_auto,q_auto,c_fill,g_auto,w_1200,ar_1.91:1/runiis/editions/carrera-demo/cover",
      );
      expect(seo.jsonLd.image).toEqual([seo.ogImage]);
    });

    test("ogImage is omitted (null, no jsonLd.image) when delivery is not configured, even with a PUBLISHED asset", () => {
      delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      const seo = buildEditionSeo(pageWithMedia(), "https://runiis.com");
      expect(seo.ogImage).toBeNull();
      expect(seo.jsonLd).not.toHaveProperty("image");
    });
  });
});
