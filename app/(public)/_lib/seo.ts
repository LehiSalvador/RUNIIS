import type { Metadata } from "next";

// Metadata builder for public pages (Master §59; filtered /eventos URLs canonical to /eventos per §55).
// Next shallow-merges `openGraph` per segment, so every page gets the full object here, including
// the default typographic social image (app/og/route.tsx) unless it passes its own.

export function siteUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3100";
}

/**
 * AUD-015: only production is indexable. Local, staging and Vercel previews are reachable URLs
 * (staging.runiismty.com is a public custom domain) and must carry noindex. Unset or unknown APP_ENV
 * fails closed (not indexable). Read at call time so tests can vary it.
 */
export function isIndexableEnvironment(): boolean {
  return process.env.APP_ENV === "production";
}

export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}

export const NON_PRODUCTION_ROBOTS = { index: false, follow: false } as const;

export const DEFAULT_OG_IMAGE = { url: "/og", width: 1200, height: 630, alt: "RUNIIS" };

export function pageMetadata({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  noindex = false,
  type = "website",
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  image?: { url: string; width?: number; height?: number; alt: string };
  noindex?: boolean;
  type?: "website" | "article";
  /** Skip the root "%s | RUNIIS" template (Home, Event pages whose title already names RUNIIS). */
  absoluteTitle?: boolean;
}): Metadata {
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    // Next replaces (does not merge) a child's `robots`, so a page-level `undefined` must itself carry
    // the non-production noindex instead of relying on the root layout.
    robots: noindex ? { index: false, follow: true } : isIndexableEnvironment() ? undefined : NON_PRODUCTION_ROBOTS,
    openGraph: { type, title, description, url: path, siteName: "RUNIIS", locale: "es_MX", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: item.url })),
  };
}
