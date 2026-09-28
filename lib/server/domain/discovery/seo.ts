import "server-only";
import type { z } from "zod";
import { publicMediaUrl } from "@/lib/shared/media-url";
import type { editionPageSchema } from "./contracts";

// Master §59: per PUBLISHED Edition — title, description, canonical, OG image, SportsEvent/Event
// JSON-LD, breadcrumbs. Pure function (base URL + already-fetched page data in, plain data out) so
// it is unit-testable without a database. "No invented time" (Master §29/§58): startDate is date-only
// when the schedule's time is pending, omitted entirely when there is no known date at all.

export type EditionPage = z.output<typeof editionPageSchema>;

export type EditionSeo = {
  title: string;
  description: string;
  canonical: string;
  ogImage: string | null;
  breadcrumbs: { name: string; url: string }[];
  jsonLd: Record<string, unknown>;
};

const EXECUTION_STATUS: Record<EditionPage["edition"]["execution_state"], string> = {
  SCHEDULED: "https://schema.org/EventScheduled",
  IN_PROGRESS: "https://schema.org/EventScheduled",
  POSTPONED: "https://schema.org/EventPostponed",
  CANCELED: "https://schema.org/EventCancelled",
  FINISHED: "https://schema.org/EventScheduled",
};

function plainTextExcerpt(markdown: string, maxLength: number): string {
  // Markdown is never re-rendered here (SEC-061 stays with the content-block domain); this only
  // strips the handful of characters that would look like syntax noise in a meta description.
  const text = markdown.replaceAll(/[#*_`>[\]]/g, "").replaceAll(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

export function buildEditionSeo(page: EditionPage, baseUrl: string): EditionSeo {
  const canonical = new URL(`/eventos/${page.edition.slug}`, baseUrl).toString();
  const description =
    page.content_blocks
      .filter((block) => block.block_type === "RICH_TEXT" || block.block_type === "CUSTOM_SECTION")
      .map((block) => (typeof block.payload.markdown === "string" ? block.payload.markdown : ""))
      .find((markdown) => markdown.trim().length > 0) ??
    `${page.edition.name} — ${page.edition.city}, ${page.edition.state_region}. Inscríbete en RUNIIS.`;

  // The delivery URL, never the raw storage key (SEC: storage_object_key is an internal Cloudinary
  // public id, not a client-facing URL). null when there is no media or delivery isn't configured
  // (no cloud name) — the caller omits the image rather than rendering a broken one.
  const image = page.media[0] ? publicMediaUrl(page.media[0].storage_object_key, { width: 1200, aspect: "1.91:1" }) : null;
  const schedule = page.edition.schedule;

  const startDate =
    schedule?.schedule_state === "DATE_TIME_CONFIRMED" && schedule.effective_start_at
      ? schedule.effective_start_at
      : schedule?.schedule_state === "DATE_CONFIRMED_TIME_PENDING" && schedule.local_date
        ? schedule.local_date
        : undefined;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: page.edition.name,
    url: canonical,
    eventStatus: EXECUTION_STATUS[page.edition.execution_state],
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: page.locations.find((location) => location.is_primary)?.name ?? page.edition.city,
      address: {
        "@type": "PostalAddress",
        addressLocality: page.edition.city,
        addressRegion: page.edition.state_region,
        addressCountry: page.edition.country_code,
      },
    },
    ...(startDate ? { startDate } : {}),
    ...(image ? { image: [image] } : {}),
  };

  return {
    title: `${page.edition.name} — RUNIIS`,
    description: plainTextExcerpt(description, 160),
    canonical,
    ogImage: image,
    breadcrumbs: [
      { name: "Inicio", url: new URL("/", baseUrl).toString() },
      { name: "Eventos", url: new URL("/eventos", baseUrl).toString() },
      { name: page.edition.name, url: canonical },
    ],
    jsonLd,
  };
}
