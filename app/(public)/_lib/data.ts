import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { cacheTags } from "@/lib/server/cache/invalidation";
import { getEditionPage, getHomeData, getSitemapEntries, searchEditions, type SearchEditionsParams } from "@/lib/server/domain/discovery/service";
import { getPublicLegalDocument } from "@/lib/server/domain/events/service";
import { getEditionRoutes } from "@/lib/server/domain/routes/service";
import { createAnonClient } from "@/lib/server/supabase/clients";

// Page-level caching for the public surfaces (discovery service doc comment: caching is a rendering
// decision). Editorial data carries the `editions` tag so the Master §60 invalidators refresh it.
// Cards embed an availability *state* (never counts), which Master §60 allows under a short TTL;
// the Event page itself never renders cached availability -- it fetches it fresh in the browser.

const CARD_TTL_SECONDS = 60;
const EDITORIAL_TTL_SECONDS = 300;

export const cachedHomeData = unstable_cache(() => getHomeData(), ["public-home"], {
  tags: [cacheTags.editions],
  revalidate: CARD_TTL_SECONDS,
});

// The serialized params are part of the cache key; callers build them from the canonical filter
// state (lib/shared/event-filters.ts) so equal views share one entry.
export const cachedSearchEditions = unstable_cache((params: SearchEditionsParams) => searchEditions(params), ["public-search"], {
  tags: [cacheTags.editions],
  revalidate: CARD_TTL_SECONDS,
});

// React cache() dedupes the generateMetadata + page render pair within one request.
export const cachedEditionPage = cache((slug: string) =>
  unstable_cache(() => getEditionPage(slug), ["public-edition-page", slug], {
    tags: [cacheTags.editions],
    revalidate: EDITORIAL_TTL_SECONDS,
  })(),
);

export const cachedEditionRoutes = cache((editionId: string) =>
  unstable_cache(() => getEditionRoutes(createAnonClient(), editionId), ["public-edition-routes", editionId], {
    tags: [cacheTags.editions, cacheTags.edition(editionId)],
    revalidate: EDITORIAL_TTL_SECONDS,
  })(),
);

export const cachedSitemapEntries = unstable_cache(() => getSitemapEntries(), ["public-sitemap"], {
  tags: [cacheTags.editions],
  revalidate: EDITORIAL_TTL_SECONDS,
});

export const LEGAL_DOCUMENTS = {
  terminos: { key: "TERMS_OF_SERVICE", title: "Términos y condiciones", path: "/legal/terminos" },
  privacidad: { key: "PRIVACY_NOTICE", title: "Aviso de privacidad", path: "/legal/privacidad" },
} as const;

// LegalDocumentPublished (T31c-cache-invalidation) invalidates the shared `legal` tag on publish,
// same as every other editorial read here; the TTL is a fallback bound, not the primary mechanism.
export const cachedLegalDocument = cache((documentKey: string) =>
  unstable_cache(() => getPublicLegalDocument(createAnonClient(), documentKey), ["public-legal", documentKey], {
    tags: [cacheTags.legal],
    revalidate: EDITORIAL_TTL_SECONDS,
  })(),
);
