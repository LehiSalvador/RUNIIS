import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarX, CircleAlert, Flag, MessageCircle, Search, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Runline } from "@/components/ui/runline";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Container } from "@/components/shell/container";
import { Wordmark } from "@/components/shell/wordmark";
import { EventCard, type EventCardData } from "@/components/public/event-card";
import { SectionHeading } from "@/components/public/section-heading";
import { JsonLd } from "@/components/public/json-ld";
import { cachedHomeData } from "@/app/(public)/_lib/data";
import { absoluteUrl, pageMetadata } from "@/app/(public)/_lib/seo";
import { dateTileParts, publicStatus, summarizeDistance, summarizePrice } from "@/lib/shared/public-event";

// ISR: cards carry an availability state, which Master §60 allows under a short TTL.
export const revalidate = 60;

export const metadata: Metadata = pageMetadata({
  title: "RUNIIS — Descubre carreras e inscríbete",
  description: "Carreras organizadas y operadas por el equipo RUNIIS: consulta fechas, distancias, precios y disponibilidad, e inscríbete en línea.",
  path: "/",
  absoluteTitle: true,
});

const QUICK_FILTERS = [
  { href: "/eventos?registration_open=true", label: "Inscripciones abiertas" },
  { href: "/eventos?price=FREE", label: "Gratis" },
  { href: "/eventos?distance_max_m=5000", label: "Hasta 5 km" },
  { href: "/eventos?type=ROAD_RACE", label: "Carrera de ruta" },
  { href: "/eventos?type=TRAIL", label: "Trail" },
] as const;

async function loadHome() {
  try {
    return { ok: true as const, data: await cachedHomeData() };
  } catch {
    return { ok: false as const };
  }
}

function NextStartBoard({ card }: { card: EventCardData }) {
  const parts = card.sport_date ? dateTileParts(card.sport_date) : null;
  const status = publicStatus(card.registration_state, card.execution_state, card.availability?.global_state ?? null);
  return (
    <section aria-labelledby="proxima-salida" className="surface-ink relative overflow-hidden rounded-panel bg-ink p-6 text-paper sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 id="proxima-salida" className="text-label font-semibold text-paper/80">
          Próxima salida
        </h2>
        <StatusBadge state={status.state} label={status.label} />
      </div>
      {parts ? (
        <p className="mt-6 flex items-end gap-3 font-display font-bold text-lime">
          <span className="sr-only">Fecha: {parts.day} {parts.month} {parts.year}</span>
          <span aria-hidden="true" className="text-[120px] leading-[0.8] tabular-nums sm:text-[152px]">{parts.day}</span>
          <span aria-hidden="true" className="flex flex-col pb-2 text-h2 leading-none">
            <span>{parts.month}</span>
            <span className="text-paper/70">{parts.year}</span>
          </span>
        </p>
      ) : (
        <p className="mt-6 font-display text-h2 font-bold text-lime">Fecha por confirmar</p>
      )}
      <hr className="mt-6 border-paper/15" />
      <p className="mt-6 font-display text-h3 font-bold leading-tight text-paper">{card.name}</p>
      <p className="mt-2 text-body text-paper/80">
        {card.city}, {card.state_region}
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-paper/15 pt-5">
        <div>
          <dt className="text-caption text-paper/70">Distancia</dt>
          <dd className="mt-1 font-display text-h4 font-bold tabular-nums text-paper">{summarizeDistance(card.modality_summary)}</dd>
        </div>
        <div>
          <dt className="text-caption text-paper/70">Precio</dt>
          <dd className="mt-1 font-display text-h4 font-bold tabular-nums text-paper">{summarizePrice(card.modality_summary)}</dd>
        </div>
      </dl>
      <Link
        href={`/eventos/${card.slug}`}
        className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-control bg-lime px-5 text-button font-semibold text-ink transition-colors duration-fast ease-standard hover:bg-lime-soft sm:w-auto"
      >
        Ver carrera
        <ArrowRight className="size-5" aria-hidden="true" />
      </Link>
    </section>
  );
}

export default async function HomePage() {
  const home = await loadHome();
  const upcoming = home.ok ? home.data.upcoming : [];
  const featured = upcoming.find((card) => card.execution_state === "SCHEDULED") ?? null;

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "RUNIIS",
          url: absoluteUrl("/"),
          potentialAction: {
            "@type": "SearchAction",
            target: `${absoluteUrl("/eventos")}?q={search_term_string}`,
            "query-input": "required name=search_term_string",
          },
        }}
      />

      {/* 1. Hero */}
      <section className="border-b border-divider">
        <Container className="grid gap-10 py-10 sm:py-14 lg:grid-cols-12 lg:items-center lg:gap-12 lg:py-20">
          <div className={featured ? "lg:col-span-7" : "lg:col-span-10"}>
            <p className="text-label font-semibold text-ink-60">Carreras RUNIIS</p>
            <h1 className="mt-3 max-w-4xl font-display text-display-xl font-bold text-ink">
              Descubre carreras, inscríbete y consulta tu ranking verificado.
            </h1>
            <Runline weight="strong" className="mt-6 w-24" />
            <p className="mt-6 max-w-xl text-body-lg text-ink-80">
              Encuentra tu próxima carrera, revisa fechas, distancias y precios, y arma tu inscripción con amigos e
              invitados.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/eventos">
                  Ver próximas carreras
                  <ArrowRight className="size-5" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/runiis">Conoce RUNIIS</Link>
              </Button>
            </div>
          </div>
          {featured ? (
            <div className="lg:col-span-5">
              <NextStartBoard card={featured} />
            </div>
          ) : null}
        </Container>
      </section>

      {/* 2. Próximas carreras */}
      <section aria-labelledby="proximas-carreras" className="py-12 lg:py-20">
        <Container>
          <SectionHeading
            id="proximas-carreras"
            title="Próximas carreras"
            description="Ordenadas por fecha: la más cercana primero."
            action={{ href: "/eventos", label: "Ver todas" }}
          />
          <div className="mt-8 lg:mt-10">
            {!home.ok ? (
              <div role="alert" className="rounded-card border border-danger-border bg-danger-tint">
                <EmptyState
                  icon={CircleAlert}
                  title="No pudimos cargar las próximas carreras"
                  description="Es un error de nuestro lado, no de tu búsqueda. Intenta de nuevo en unos momentos."
                  action={
                    <Button asChild variant="secondary">
                      <Link href="/eventos">Ir a la biblioteca de eventos</Link>
                    </Button>
                  }
                />
              </div>
            ) : upcoming.length === 0 ? (
              <div className="rounded-card border border-divider bg-paper-raised">
                <EmptyState
                  icon={CalendarX}
                  title="No hay próximos eventos"
                  description="Aún no hay carreras publicadas con fecha próxima. Consulta los eventos anteriores en la biblioteca."
                  action={
                    <Button asChild variant="secondary">
                      <Link href="/eventos">Ver biblioteca</Link>
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
                {upcoming.map((card, index) => (
                  <li key={card.edition_id} className="flex">
                    <EventCard card={card} priority={index === 0} className="w-full" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Container>
      </section>

      {/* 3. Acceso biblioteca */}
      <section aria-labelledby="biblioteca" className="pb-12 lg:pb-20">
        <Container>
          <div className="grid gap-8 rounded-panel border border-divider bg-paper-raised p-6 sm:p-8 lg:grid-cols-12 lg:items-center lg:p-10">
            <div className="lg:col-span-5">
              <h2 id="biblioteca" className="font-display text-h2 font-bold text-ink">
                Busca en la biblioteca de eventos
              </h2>
              <p className="mt-3 text-body text-ink-80">Por nombre, ciudad o distancia, con eventos próximos y anteriores.</p>
            </div>
            <div className="lg:col-span-7">
              <form action="/eventos" method="get" role="search" aria-label="Buscar eventos" className="flex flex-col gap-3 sm:flex-row">
                <label htmlFor="home-search" className="sr-only">
                  Buscar eventos
                </label>
                <div className="flex-1">
                  <input
                    id="home-search"
                    name="q"
                    type="search"
                    maxLength={160}
                    placeholder="Ej. Monterrey, 10K, trail"
                    className="h-12 w-full rounded-control border border-control bg-paper-raised px-4 text-body text-ink placeholder:text-ink-60 transition-colors duration-fast ease-standard hover:border-ink-60 focus-visible:border-ink"
                  />
                </div>
                <Button type="submit" size="lg">
                  <Search className="size-5" aria-hidden="true" />
                  Buscar
                </Button>
              </form>
              <nav aria-label="Atajos de la biblioteca" className="mt-5">
                <ul className="flex flex-wrap gap-2">
                  {QUICK_FILTERS.map((filter) => (
                    <li key={filter.href}>
                      <Link
                        href={filter.href}
                        className="inline-flex min-h-11 items-center rounded-full border border-control px-4 text-label font-semibold text-ink transition-colors duration-fast ease-standard hover:border-ink hover:bg-paper-sunken"
                      >
                        {filter.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>
        </Container>
      </section>

      {/* 4. Comunidad/podio: rendered only once rankings exist (community_slot.available). */}

      {/* 5. Información RUNIIS */}
      <section aria-labelledby="sobre-runiis" className="border-t border-divider py-12 lg:py-20">
        <Container className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Wordmark size="large" />
            <h2 id="sobre-runiis" className="mt-6 font-display text-h2 font-bold text-ink">
              Eventos creados y operados por RUNIIS
            </h2>
            <p className="mt-4 max-w-md text-body-lg text-ink-80">
              RUNIIS publica, administra y opera sus propios eventos deportivos. No es un marketplace de eventos de
              terceros.
            </p>
            <Link
              href="/runiis"
              className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-button font-semibold text-ink underline decoration-divider underline-offset-8 hover:decoration-ink"
            >
              Más sobre RUNIIS
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-card border border-divider bg-divider sm:grid-cols-3 lg:col-span-7 lg:self-end">
            {[
              { icon: Search, title: "Descubre", body: "Consulta fechas, distancias, precios y disponibilidad de cada carrera." },
              { icon: Ticket, title: "Inscríbete", body: "Tu cuenta de participante reúne tus inscripciones." },
              { icon: Flag, title: "Corre", body: "El mismo equipo opera cada evento el día de la carrera." },
            ].map((item) => (
              <div key={item.title} className="bg-paper-raised p-5 sm:p-6">
                <dt>
                  <item.icon className="size-7 text-ink-60" aria-hidden="true" />
                  <span className="mt-4 block text-h4 font-bold text-ink">{item.title}</span>
                </dt>
                <dd className="mt-2 text-body-sm text-ink-80">{item.body}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* 7. Contacto */}
      <section aria-labelledby="contacto-home" className="border-t border-divider py-12 lg:py-16">
        <Container className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <MessageCircle className="mt-1 size-8 shrink-0 text-ink-60" aria-hidden="true" />
            <div>
              <h2 id="contacto-home" className="font-display text-h3 font-bold text-ink sm:text-h2">
                ¿Dudas sobre una carrera?
              </h2>
              <p className="mt-2 max-w-xl text-body text-ink-80">
                Cada evento muestra su propio canal de contacto. Para temas generales, visita la página de contacto.
              </p>
            </div>
          </div>
          <Button asChild variant="secondary" size="lg" className="shrink-0">
            <Link href="/contacto">Ir a contacto</Link>
          </Button>
        </Container>
      </section>
    </>
  );
}
