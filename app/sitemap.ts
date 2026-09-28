import type { MetadataRoute } from "next";
import { LEGAL_DOCUMENTS, cachedLegalDocument, cachedSitemapEntries } from "@/app/(public)/_lib/data";
import { absoluteUrl } from "@/app/(public)/_lib/seo";

export const revalidate = 3600;

// Master §59: every PUBLISHED Edition's current slug plus the static public pages. Legal pages are
// listed only once a version is published (before that they are noindex placeholders).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/eventos"), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/runiis"), changeFrequency: "monthly", priority: 0.4 },
    { url: absoluteUrl("/contacto"), changeFrequency: "monthly", priority: 0.3 },
  ];

  for (const legal of Object.values(LEGAL_DOCUMENTS)) {
    const document = await cachedLegalDocument(legal.key).catch(() => null);
    if (document) pages.push({ url: absoluteUrl(legal.path), lastModified: document.published_at, changeFrequency: "yearly", priority: 0.2 });
  }

  const editions = await cachedSitemapEntries().catch(() => []);
  for (const entry of editions) {
    pages.push({ url: absoluteUrl(`/eventos/${entry.slug}`), lastModified: entry.updated_at, changeFrequency: "weekly", priority: 0.8 });
  }
  return pages;
}
