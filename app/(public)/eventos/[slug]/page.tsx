import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { CalendarDays, ChevronRight, Clock, MapPin, Route as RouteIcon, Tag } from "lucide-react";
import { mapCta } from "@/lib/server/domain/discovery/cta";
import { buildEditionSeo, type EditionPage } from "@/lib/server/domain/discovery/seo";
import { Alert } from "@/components/ui/alert";
import { Container } from "@/components/shell/container";
import { EventCover } from "@/components/public/event-cover";
import { JsonLd } from "@/components/public/json-ld";
import {
  AvailabilityNotice,
  AvailabilityProvider,
  EventCta,
  EventStatusBadge,
  ModalityAvailabilityBadge,
  type CtaByAvailability,
} from "@/components/public/event/availability";
import { StickyCta } from "@/components/public/event/sticky-cta";
import {
  Agenda,
  CalloutBlock,
  Categories,
  Contact,
  Documents,
  EventSection,
  Faq,
  Kits,
  LocationList,
  RichTextBlock,
  RouteBlock,
  Sponsors,
} from "@/components/public/event/event-sections";
import { cachedEditionPage, cachedEditionRoutes } from "@/app/(public)/_lib/data";
import { absoluteUrl, breadcrumbJsonLd, pageMetadata, siteUrl } from "@/app/(public)/_lib/seo";
import { publicMediaUrl } from "@/lib/shared/media-url";
import {
  formatDistance,
  formatLocalTime,
  formatLongDate,
  formatMoney,
  formatShortDate,
  scheduleDisplay,
  summarizePrice,
  whatsAppContactUrl,
  type ModalitySummary,
} from "@/lib/shared/public-event";

// On-demand ISR per slug; editorial data is tag-invalidated (Master §60). Availability is never part
// of this cached render -- see components/public/event/availability.tsx.
export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

const SLUG = /^[a-z0-9](-?[a-z0-9]+)*$/;
type Params = Promise<{ slug: string }>;

async function loadEdition(slug: string): Promise<EditionPage> {
  if (slug.length > 160 || !SLUG.test(slug)) notFound();
  const result = await cachedEditionPage(slug);
  if (!result) notFound();
  // Master §59: a historical slug is a permanent (308) redirect to the current one.
  if (result.redirect) permanentRedirect(`/eventos/${result.slug}`);
  return result.edition;
}

function ogImage(page: EditionPage) {
  const media = page.media[0];
  const url = media ? publicMediaUrl(media.storage_object_key, { width: 1200, aspect: "1.91:1" }) : null;
  return url
    ? { url, width: 1200, height: 628, alt: media.alt_text }
    : { url: `/og/eventos/${page.edition.slug}`, width: 1200, height: 630, alt: page.edition.name };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = await loadEdition((await params).slug);
  const seo = buildEditionSeo(page, siteUrl());
  return pageMetadata({ title: seo.title, description: seo.description, path: `/eventos/${page.edition.slug}`, image: ogImage(page), absoluteTitle: true });
}

function priceSummary(modalities: EditionPage["modalities"]): ModalitySummary {
  const live = modalities.filter((m) => m.status !== "CANCELED");
  const amounts = live.flatMap((m) => (m.price ? [m.price.amount_minor] : []));
  const currency = live.find((m) => m.price)?.price?.currency ?? null;
  return {
    count: live.length,
    min_distance_m: null,
    max_distance_m: null,
    distance_varies: false,
    min_amount_minor: amounts.length ? Math.min(...amounts) : null,
    max_amount_minor: amounts.length ? Math.max(...amounts) : null,
    currency,
    price_varies: new Set(amounts).size > 1,
    price_pending: amounts.length < live.length,
  };
}

function officialDistances(modalities: EditionPage["modalities"]): number[] {
  return [...new Set(modalities.filter((m) => m.status !== "CANCELED" && m.official_distance_m).map((m) => m.official_distance_m as number))].sort((a, b) => a - b);
}

function distanceSummary(modalities: EditionPage["modalities"]): string {
  const distances = officialDistances(modalities);
  return distances.length === 0 ? "Por confirmar" : distances.map(formatDistance).join(" · ");
}

/** Compact range for the cover tile ("10–21.1 km"). */
function distanceRange(modalities: EditionPage["modalities"]): string {
  const distances = officialDistances(modalities);
  if (distances.length === 0) return "";
  const [min, max] = [distances[0], distances[distances.length - 1]];
  return min === max ? formatDistance(min) : `${formatDistance(min).replace(/ km$/, "")}–${formatDistance(max)}`;
}

function modalityPrice(m: EditionPage["modalities"][number], timezone: string): { amount: string; note: string | null } {
  if (!m.price) return { amount: "Precio por confirmar", note: null };
  if (m.price.source === "FREE") return { amount: "Gratis", note: null };
  const until = m.price.ends_at
    ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: timezone }).format(new Date(m.price.ends_at)).replace(/\./g, "")
    : null;
  return { amount: formatMoney(m.price.amount_minor, m.price.currency), note: [m.price.name, until ? `vigente hasta el ${until}` : null].filter(Boolean).join(" · ") };
}

function ctaMap(page: EditionPage): CtaByAvailability {
  const { registration_state: reg, execution_state: exec } = page.edition;
  return {
    NONE: mapCta(reg, exec, null),
    AVAILABLE: mapCta(reg, exec, "AVAILABLE"),
    LOW: mapCta(reg, exec, "LOW"),
    TEMPORARILY_UNAVAILABLE: mapCta(reg, exec, "TEMPORARILY_UNAVAILABLE"),
    SOLD_OUT: mapCta(reg, exec, "SOLD_OUT"),
  };
}

/** Master §56 page variants that do not depend on live availability. */
function StateNotice({ page }: { page: EditionPage }) {
  const { edition } = page;
  const schedule = scheduleDisplay(edition.schedule);
  if (edition.execution_state === "CANCELED") {
    return <Alert tone="danger" title="Evento cancelado">Esta edición fue cancelada. Mantenemos la página como referencia.</Alert>;
  }
  if (edition.execution_state === "POSTPONED") {
    return (
      <Alert tone="warning" title="Evento aplazado">
        {schedule.kind === "postponed" || schedule.kind === "unknown"
          ? "La nueva fecha aún no se publica. La verás en esta página en cuanto se confirme."
          : "La edición cambió de fecha; consulta la fecha vigente arriba."}
      </Alert>
    );
  }
  if (edition.execution_state === "FINISHED") {
    return <Alert tone="info" title="Evento realizado">Esta edición ya se llevó a cabo.</Alert>;
  }
  if (edition.registration_state === "CLOSED") {
    return <Alert tone="info" title="Inscripción cerrada">Las inscripciones para esta edición ya cerraron.</Alert>;
  }
  if (edition.registration_state === "NOT_OPEN") {
    const opens = edition.registration_open_at
      ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: edition.timezone }).format(new Date(edition.registration_open_at))
      : null;
    return (
      <Alert tone="info" title="Inscripciones próximamente">
        {opens ? `Las inscripciones abren el ${opens} (hora local del evento).` : "La fecha de apertura de inscripciones aún no se publica."}
      </Alert>
    );
  }
  if (edition.registration_state === "PAUSED") {
    return <Alert tone="info" title="Temporalmente sin disponibilidad">Las inscripciones están en pausa por el momento.</Alert>;
  }
  return <AvailabilityNotice />;
}

function DateFact({ page }: { page: EditionPage }) {
  const schedule = scheduleDisplay(page.edition.schedule);
  const times = new Set(page.modalities.flatMap((m) => (m.effective_start?.local_start_time ? [m.effective_start.local_start_time] : [])));
  if (schedule.kind === "confirmed") {
    return (
      <>
        <span className="block first-letter:uppercase">{formatLongDate(schedule.date)}</span>
        {schedule.time ? (
          <span className="block text-body-sm text-ink-80">
            {times.size > 1 ? "Primera salida" : "Salida"} {formatLocalTime(schedule.time)}
          </span>
        ) : null}
      </>
    );
  }
  if (schedule.kind === "time_pending") {
    return (
      <>
        <span className="block first-letter:uppercase">{formatLongDate(schedule.date)}</span>
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-warning-border bg-warning-tint px-2.5 py-0.5 text-label font-semibold text-warning">
          <Clock className="size-4" aria-hidden="true" />
          Hora por confirmar
        </span>
      </>
    );
  }
  if (schedule.kind === "postponed") return <span className="block">Nueva fecha por confirmar</span>;
  return <span className="block">Fecha por confirmar</span>;
}

export default async function EventPage({ params }: { params: Params }) {
  const page = await loadEdition((await params).slug);
  const { edition, event } = page;
  let routes: Awaited<ReturnType<typeof cachedEditionRoutes>> = [];
  let routesError = false;
  try {
    routes = await cachedEditionRoutes(edition.edition_id);
  } catch {
    routesError = true;
  }

  const seo = buildEditionSeo(page, siteUrl());
  const price = priceSummary(page.modalities);
  const priceLabel = summarizePrice(price);
  const hero = page.media[0] ?? null;
  const heroImage = hero ? publicMediaUrl(hero.storage_object_key, { width: 1600, aspect: "16:9" }) : null;
  const primary = page.locations.find((l) => l.is_primary) ?? page.locations[0] ?? null;
  const venue = page.locations.find((l) => l.location_type === "VENUE") ?? primary;
  const logistics = page.locations.filter((l) => ["DISCOVERY", "VENUE", "START", "FINISH", "KIT_PICKUP"].includes(l.location_type));
  const extraPoints = page.locations.filter((l) => ["MEETING_POINT", "PARKING", "OTHER"].includes(l.location_type));
  const blocks = [...page.content_blocks].sort((a, b) => a.position - b.position);
  const byType = (type: string) => blocks.filter((b) => b.block_type === type);
  const richText = blocks.filter((b) => b.block_type === "RICH_TEXT" || b.block_type === "CUSTOM_SECTION");
  const callouts = byType("CALLOUT");
  const faqs = byType("FAQ");
  const documents = byType("DOCUMENT_LINK");
  const sponsors = byType("SPONSOR_GROUP");
  const whatsappUrl = whatsAppContactUrl(page.whatsapp.phone_e164);
  const activeModalities = page.modalities;

  const jsonLd = {
    ...seo.jsonLd,
    description: seo.description,
    image: heroImage ? [heroImage] : undefined,
    organizer: { "@type": "Organization", name: "RUNIIS", url: absoluteUrl("/") },
    ...(price.min_amount_minor !== null && price.currency
      ? {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: price.currency,
            lowPrice: (price.min_amount_minor / 100).toFixed(2),
            highPrice: ((price.max_amount_minor ?? price.min_amount_minor) / 100).toFixed(2),
            url: seo.canonical,
          },
        }
      : {}),
  };

  return (
    <AvailabilityProvider slug={edition.slug} registration={edition.registration_state} execution={edition.execution_state} ctas={ctaMap(page)}>
      <JsonLd data={jsonLd} />
      <JsonLd data={breadcrumbJsonLd(seo.breadcrumbs)} />
      <Container className="pt-4 pb-28 lg:pt-8 lg:pb-20">
        <nav aria-label="Ruta de navegación" className="mb-4 lg:mb-6">
          <ol className="flex flex-wrap items-center gap-1 text-body-sm text-ink-60">
            <li>
              <Link href="/" className="inline-flex min-h-11 items-center hover:text-ink">Inicio</Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4" /></li>
            <li>
              <Link href="/eventos" className="inline-flex min-h-11 items-center hover:text-ink">Eventos</Link>
            </li>
            <li aria-hidden="true"><ChevronRight className="size-4" /></li>
            <li aria-current="page" className="truncate text-ink">{edition.name}</li>
          </ol>
        </nav>

        <div className="lg:grid lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col gap-8 lg:col-span-8">
            {/* Level 1 */}
            <div className="flex flex-col gap-6">
              <EventCover
                image={hero}
                sportDate={edition.schedule?.local_date ?? null}
                distanceLabel={distanceRange(activeModalities)}
                variant="hero"
                priority
                overlay={<EventStatusBadge className="bg-paper-raised/95" />}
              />
              <div>
                <p className="text-label font-semibold text-ink-60">{event.event_type_name}</p>
                <h1 className="mt-2 font-display text-h1 font-bold text-ink">{edition.name}</h1>
              </div>
              <dl className="grid gap-px overflow-hidden rounded-card border border-divider bg-divider md:grid-cols-2">
                <div className="bg-paper-raised p-4">
                  <dt className="flex items-center gap-3 text-caption text-ink-60">
                    <CalendarDays className="size-5 shrink-0" aria-hidden="true" />
                    Fecha y hora
                  </dt>
                  <dd className="pl-8 font-semibold tabular-nums text-ink"><DateFact page={page} /></dd>
                </div>
                <div className="bg-paper-raised p-4">
                  <dt className="flex items-center gap-3 text-caption text-ink-60">
                    <MapPin className="size-5 shrink-0" aria-hidden="true" />
                    Ubicación
                  </dt>
                  <dd className="pl-8 font-semibold text-ink">
                      {primary?.name ?? edition.city}
                      <span className="block text-body-sm font-normal text-ink-80">
                        {edition.city}, {edition.state_region}
                      </span>
                    </dd>
                </div>
                <div className="bg-paper-raised p-4">
                  <dt className="flex items-center gap-3 text-caption text-ink-60">
                    <RouteIcon className="size-5 shrink-0" aria-hidden="true" />
                    Distancia
                  </dt>
                  <dd className="pl-8 font-semibold tabular-nums text-ink">
                      {distanceSummary(activeModalities)}
                      <span className="block text-body-sm font-normal text-ink-80">
                        {activeModalities.length === 1 ? "1 modalidad" : `${activeModalities.length} modalidades`}
                      </span>
                    </dd>
                </div>
                <div className="bg-paper-raised p-4">
                  <dt className="flex items-center gap-3 text-caption text-ink-60">
                    <Tag className="size-5 shrink-0" aria-hidden="true" />
                    Precio
                  </dt>
                  <dd className="pl-8 font-semibold tabular-nums text-ink">
                      {priceLabel}
                      <span className="block text-body-sm font-normal text-ink-80">
                        {edition.registration_mode === "FREE" ? "Inscripción gratuita" : "El pago se confirma con el equipo RUNIIS por WhatsApp"}
                      </span>
                    </dd>
                </div>
              </dl>

              <div id="cta-inline" className="lg:hidden">
                <EventCta idSuffix="inline" />
              </div>

              <StateNotice page={page} />
              {callouts.map((block) => <CalloutBlock key={block.event_content_block_id} block={block} />)}
            </div>

            {richText.length > 0 ? (
              <EventSection id="acerca" title="Acerca del evento">
                <div className="flex flex-col gap-6">
                  {richText.map((block) => <RichTextBlock key={block.event_content_block_id} block={block} />)}
                </div>
              </EventSection>
            ) : null}

            <EventSection id="modalidades" title="Modalidades">
              {activeModalities.length === 0 ? (
                <p className="text-body text-ink-80">Las modalidades de esta edición se anunciarán pronto.</p>
              ) : (
                <ul className="divide-y divide-divider rounded-card border border-divider bg-paper-raised">
                  {activeModalities.map((m) => {
                    const p = modalityPrice(m, edition.timezone);
                    const start = m.effective_start;
                    return (
                      <li key={m.modality_id} className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-start">
                        <div>
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="font-display text-h3 font-bold text-ink">{m.name}</h3>
                            <ModalityAvailabilityBadge modalityId={m.modality_id} modalityStatus={m.status} />
                          </div>
                          <p className="mt-1 text-body-sm text-ink-80 tabular-nums">
                            {[
                              m.official_distance_m ? formatDistance(m.official_distance_m) : "Distancia por confirmar",
                              start?.local_start_time
                                ? `Salida ${formatLocalTime(start.local_start_time)}`
                                : start?.schedule_state === "DATE_CONFIRMED_TIME_PENDING"
                                  ? "Hora por confirmar"
                                  : null,
                              start && start.local_date !== edition.schedule?.local_date ? formatShortDate(start.local_date) : null,
                              m.generates_distance_credit ? "Suma kilómetros verificados" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <p className="font-display text-h3 font-bold tabular-nums text-ink">{p.amount}</p>
                          {p.note ? <p className="text-caption text-ink-60">{p.note}</p> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </EventSection>

            {/* Level 2 */}
            {logistics.length > 0 ? (
              <EventSection id="logistica" title="Logística">
                <LocationList locations={logistics} />
              </EventSection>
            ) : null}

            {page.agenda.length > 0 ? (
              <EventSection id="agenda" title="Agenda">
                <Agenda items={page.agenda} locations={page.locations} modalities={page.modalities} />
              </EventSection>
            ) : null}

            {routes.length > 0 || routesError ? (
              <EventSection id="ruta" title="Ruta">
                {routesError ? (
                  <Alert tone="danger" title="No pudimos cargar la ruta">
                    Intenta recargar la página en unos momentos.
                  </Alert>
                ) : (
                  <div className="flex flex-col gap-10">
                    {routes.map((route) => <RouteBlock key={route.route_id} route={route} modalities={page.modalities} venue={venue} />)}
                  </div>
                )}
              </EventSection>
            ) : null}

            {page.kits.filter((k) => k.status === "ACTIVE").length > 0 ? (
              <EventSection id="kit" title="Kit">
                <Kits kits={page.kits.filter((k) => k.status === "ACTIVE")} timezone={edition.timezone} />
              </EventSection>
            ) : null}

            {page.categories.filter((c) => c.active).length > 0 ? (
              <EventSection id="categorias" title="Categorías">
                <Categories categories={page.categories.filter((c) => c.active)} modalities={page.modalities} />
              </EventSection>
            ) : null}

            {extraPoints.length > 0 ? (
              <EventSection id="puntos" title="Puntos adicionales">
                <LocationList locations={extraPoints} />
              </EventSection>
            ) : null}

            {/* Level 3 */}
            {faqs.length > 0 ? (
              <EventSection id="preguntas" title="Preguntas frecuentes">
                <Faq blocks={faqs} />
              </EventSection>
            ) : null}

            {documents.length > 0 ? (
              <EventSection id="documentos" title="Documentos">
                <Documents blocks={documents} />
              </EventSection>
            ) : null}

            {sponsors.length > 0 ? (
              <EventSection id="patrocinadores" title="Patrocinadores">
                <Sponsors blocks={sponsors} />
              </EventSection>
            ) : null}

            <EventSection id="contacto" title="Contacto">
              <Contact whatsappUrl={whatsappUrl} />
            </EventSection>
          </div>

          <aside aria-label="Resumen de inscripción" className="hidden lg:col-span-4 lg:block">
            <div className="sticky top-24 flex flex-col gap-5 rounded-panel border border-divider bg-paper-raised p-6">
              <EventStatusBadge className="self-start" />
              <div>
                <p className="text-caption text-ink-60">Precio</p>
                <p className="font-display text-h2 font-bold leading-tight tabular-nums text-ink">{priceLabel}</p>
              </div>
              <dl className="grid gap-3 border-t border-divider pt-4 text-body-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-60">Fecha</dt>
                  <dd className="text-right font-semibold tabular-nums text-ink">
                    {edition.schedule?.local_date ? formatShortDate(edition.schedule.local_date) : "Por confirmar"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-60">Lugar</dt>
                  <dd className="text-right font-semibold text-ink">{edition.city}, {edition.state_region}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-60">Distancia</dt>
                  <dd className="text-right font-semibold tabular-nums text-ink">{distanceSummary(activeModalities)}</dd>
                </div>
              </dl>
              <EventCta idSuffix="aside" />
            </div>
          </aside>
        </div>
      </Container>
      <StickyCta targetId="cta-inline" priceLabel={priceLabel} />
    </AvailabilityProvider>
  );
}
