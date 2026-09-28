import React from "react";
import type { Metadata } from "next";
import { Container } from "@/components/shell/container";
import { SectionHeading } from "@/components/public/section-heading";
import { JsonLd } from "@/components/public/json-ld";
import { EventLibrary } from "@/components/public/library/event-library";
import { cachedSearchEditions } from "@/app/(public)/_lib/data";
import { absoluteUrl, breadcrumbJsonLd, pageMetadata } from "@/app/(public)/_lib/seo";
import { LIBRARY_PAGE_SIZE, parseEventFilters, toQueryString, toSearchParams } from "@/lib/shared/event-filters";
import { todayIsoUtc } from "@/lib/shared/public-event";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Filtered URLs are shareable but not SEO pages (Master §55): every variant is canonical to /eventos.
export const metadata: Metadata = pageMetadata({
  title: "Eventos",
  description: "Biblioteca de carreras RUNIIS: busca por nombre, ciudad o distancia y filtra por fecha, tipo, precio e inscripciones abiertas.",
  path: "/eventos",
});

export default async function EventosPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseEventFilters(await searchParams);
  let initial: { items: Awaited<ReturnType<typeof cachedSearchEditions>>["items"]; nextCursor: string | null } | null = null;
  try {
    initial = await cachedSearchEditions({ ...toSearchParams(filters), limit: LIBRARY_PAGE_SIZE });
  } catch {
    initial = null;
  }

  return (
    <Container className="py-6 lg:py-12">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: absoluteUrl("/") },
          { name: "Eventos", url: absoluteUrl("/eventos") },
        ])}
      />
      <SectionHeading
        level="h1"
        title="Eventos"
        description="Busca por nombre, ciudad o distancia. Los próximos van primero; los anteriores, en su propia sección."
        className="mb-8 lg:mb-10"
      />
      <EventLibrary
        key={toQueryString(filters)}
        filters={filters}
        initial={initial}
        loadError={initial === null}
        today={todayIsoUtc()}
      />
    </Container>
  );
}
