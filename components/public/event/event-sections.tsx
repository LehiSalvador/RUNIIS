import React from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, FileText, MapPin, MessageCircle, Package, Shirt } from "lucide-react";
import type { z } from "zod";
import type { EditionPage } from "@/lib/server/domain/discovery/seo";
import type { publicRouteListSchema } from "@/lib/server/domain/routes/contracts";
import { cn } from "@/lib/client/cn";
import { Alert } from "@/components/ui/alert";
import { Markdown, safeMarkdownUrl } from "@/components/public/markdown";
import { RouteMap } from "@/components/public/event/route-map";
import {
  LOCATION_TYPE_LABEL,
  POI_TYPE_LABEL,
  describeEligibility,
  formatDistance,
  formatLocalTime,
  formatLongDate,
} from "@/lib/shared/public-event";

type Block = EditionPage["content_blocks"][number];
type Location = EditionPage["locations"][number];
type PublicRoute = z.output<typeof publicRouteListSchema>[number];

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null) : [];

export function EventSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("scroll-mt-24 border-t border-divider pt-8", className)}>
      <h2 id={id} className="font-display text-h3 font-bold text-ink sm:text-h2">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function formatPickupWindow(start: string | null, end: string | null, timezone: string): string | null {
  const fmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  if (start && end) return `Del ${fmt.format(new Date(start))} al ${fmt.format(new Date(end))}`;
  if (start) return `Desde el ${fmt.format(new Date(start))}`;
  if (end) return `Hasta el ${fmt.format(new Date(end))}`;
  return null;
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
/** Garment sizes read smallest-first; unknown variant keys keep their relative order at the end. */
function sizeRank(key: string): number {
  const index = SIZE_ORDER.indexOf(key.toUpperCase());
  return index === -1 ? SIZE_ORDER.length : index;
}

function address(location: Location): string {
  return [location.address_line, location.city, location.state_region].filter(Boolean).join(", ");
}

export function LocationList({ locations }: { locations: Location[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {locations.map((location) => (
        <li key={location.edition_location_id} className="flex gap-3 rounded-card border border-divider bg-paper-raised p-4">
          <MapPin className="mt-0.5 size-5 shrink-0 text-ink-60" aria-hidden="true" />
          <div>
            <p className="text-caption font-semibold text-ink-60">{LOCATION_TYPE_LABEL[location.location_type] ?? "Punto"}</p>
            <p className="font-semibold text-ink">{location.name}</p>
            {address(location) ? <p className="mt-0.5 text-body-sm text-ink-80">{address(location)}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Agenda({ items, locations, modalities }: { items: EditionPage["agenda"]; locations: Location[]; modalities: EditionPage["modalities"] }) {
  const byDate = new Map<string, EditionPage["agenda"]>();
  for (const item of items) byDate.set(item.local_date, [...(byDate.get(item.local_date) ?? []), item]);
  const locationName = (id: string | null) => locations.find((l) => l.edition_location_id === id)?.name ?? null;
  const modalityName = (id: string | null) => modalities.find((m) => m.modality_id === id)?.name ?? null;

  return (
    <div className="flex flex-col gap-6">
      {[...byDate.entries()].map(([date, entries]) => (
        <div key={date}>
          <h3 className="text-label font-semibold text-ink-60 first-letter:uppercase">{formatLongDate(date)}</h3>
          <ol className="mt-2 divide-y divide-divider rounded-card border border-divider bg-paper-raised">
            {entries.map((item) => {
              const canceled = item.status === "CANCELED";
              return (
                <li key={item.edition_schedule_item_id} className="grid grid-cols-[6.5rem_1fr] gap-3 p-4 sm:grid-cols-[8rem_1fr]">
                  <p className="font-display text-h4 font-bold leading-tight tabular-nums text-ink">
                    {item.local_start_time ? formatLocalTime(item.local_start_time) : <span className="font-body text-body-sm font-semibold text-warning">Hora por confirmar</span>}
                  </p>
                  <div>
                    <p className={cn("font-semibold text-ink", canceled && "line-through decoration-ink-60")}>{item.title}</p>
                    {canceled ? <p className="text-body-sm font-semibold text-danger">Cancelado</p> : null}
                    <p className="text-body-sm text-ink-80">
                      {[modalityName(item.modality_id), locationName(item.location_id), item.local_end_time ? `Termina ${formatLocalTime(item.local_end_time)}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {item.description ? <p className="mt-1 text-body-sm text-ink-80">{item.description}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

export function RouteBlock({
  route,
  modalities,
  venue,
}: {
  route: PublicRoute;
  modalities: EditionPage["modalities"];
  venue: Location | null;
}) {
  const pois = [...route.revision.pois].sort((a, b) => a.sort_order - b.sort_order);
  const start = pois.find((p) => p.poi_type === "START");
  const finish = pois.find((p) => p.poi_type === "FINISH");
  const others = pois.filter((p) => p.poi_type !== "START" && p.poi_type !== "FINISH");
  const names = route.modality_ids.map((id) => modalities.find((m) => m.modality_id === id)?.name).filter(Boolean);
  const official = [...new Set(modalities.filter((m) => route.modality_ids.includes(m.modality_id) && m.official_distance_m).map((m) => m.official_distance_m as number))];
  const coordinates = route.revision.geometry_preview.coordinates as [number, number][];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h4 font-bold text-ink">{route.name}</h3>
        {names.length > 0 ? <p className="text-body-sm text-ink-80">Modalidades: {names.join(", ")}</p> : null}
      </div>
      {coordinates.length >= 2 ? (
        <RouteMap label={`Mapa de la ${route.name}`} coordinates={coordinates} pois={pois.map(({ poi_type, longitude, latitude }) => ({ poi_type, longitude, latitude }))} />
      ) : null}
      <div data-testid="route-text" className="rounded-card border border-divider bg-paper-raised p-5">
        <h4 className="sr-only">Información de la {route.name} en texto</h4>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-ink-60">Distancia oficial</dt>
            <dd className="font-display text-h3 font-bold tabular-nums text-ink">
              {official.length > 0 ? official.map(formatDistance).join(" / ") : "Por confirmar"}
            </dd>
          </div>
          {route.revision.computed_distance_m ? (
            <div>
              <dt className="text-caption text-ink-60">Distancia del trazo publicado</dt>
              <dd className="font-display text-h3 font-bold tabular-nums text-ink">{formatDistance(route.revision.computed_distance_m)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-caption text-ink-60">Salida</dt>
            <dd className="font-semibold text-ink">{start?.name ?? "Por confirmar"}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-60">Meta</dt>
            <dd className="font-semibold text-ink">{finish?.name ?? "Por confirmar"}</dd>
          </div>
          {venue ? (
            <div className="sm:col-span-2">
              <dt className="text-caption text-ink-60">Sede</dt>
              <dd className="font-semibold text-ink">
                {venue.name}
                {address(venue) ? <span className="block text-body-sm font-normal text-ink-80">{address(venue)}</span> : null}
              </dd>
            </div>
          ) : null}
        </dl>
        {others.length > 0 ? (
          <div className="mt-5 border-t border-divider pt-4">
            <p className="text-caption text-ink-60">Puntos en la ruta</p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {others.map((poi) => (
                <li key={poi.route_poi_id} className="text-body-sm text-ink">
                  <span className="font-semibold">{POI_TYPE_LABEL[poi.poi_type] ?? "Punto"}:</span> {poi.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Kits({ kits, timezone }: { kits: EditionPage["kits"]; timezone: string }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {kits.map((kit) => {
        const pickup = formatPickupWindow(kit.pickup_start_at, kit.pickup_end_at, timezone);
        const variants = kit.variants.filter((v) => v.status === "ACTIVE").sort((a, b) => sizeRank(a.variant_key) - sizeRank(b.variant_key));
        return (
          <li key={kit.kit_definition_id} className="rounded-card border border-divider bg-paper-raised p-5">
            <div className="flex items-center gap-2">
              <Package className="size-5 text-ink-60" aria-hidden="true" />
              <h3 className="text-h4 font-bold text-ink">{kit.name}</h3>
            </div>
            {variants.length > 0 ? (
              <div className="mt-4">
                <p className="flex items-center gap-1.5 text-caption text-ink-60">
                  <Shirt className="size-4" aria-hidden="true" /> Tallas
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {variants.map((v) => (
                    <li key={v.kit_variant_id} className="rounded-full border border-control px-3 py-1 text-label font-semibold text-ink">
                      {v.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-4 text-body-sm text-ink-80">
              <span className="font-semibold text-ink">Entrega: </span>
              {pickup ?? "Fecha y lugar de entrega por confirmar."}
            </p>
            {kit.instructions ? <p className="mt-2 text-body-sm text-ink-80">{kit.instructions}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function Categories({ categories, modalities }: { categories: EditionPage["categories"]; modalities: EditionPage["modalities"] }) {
  return (
    <div className="overflow-hidden rounded-card border border-divider bg-paper-raised">
      <table className="w-full text-left text-body-sm">
        <caption className="sr-only">Categorías por modalidad</caption>
        <thead className="bg-paper-sunken text-label text-ink">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Categoría</th>
            <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">Modalidades</th>
            <th scope="col" className="px-4 py-3 font-semibold">Requisito</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {categories.map((category) => (
            <tr key={category.category_id}>
              <th scope="row" className="px-4 py-3 align-top font-semibold text-ink">
                {category.name}
                <span className="block text-caption font-normal text-ink-60">
                  {category.assignment_mode === "USER_SELECTS" ? "La eliges al inscribirte" : "Se asigna automáticamente"}
                </span>
                <span className="block text-caption font-normal text-ink-80 sm:hidden">
                  {category.modality_ids.map((id) => modalities.find((m) => m.modality_id === id)?.name).filter(Boolean).join(", ")}
                </span>
              </th>
              <td className="hidden px-4 py-3 align-top text-ink-80 sm:table-cell">
                {category.modality_ids.map((id) => modalities.find((m) => m.modality_id === id)?.name).filter(Boolean).join(", ") || "—"}
              </td>
              <td className="px-4 py-3 align-top text-ink-80">{describeEligibility(category.eligibility_rule) ?? "Sin requisito"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RichTextBlock({ block }: { block: Block }) {
  const markdown = str(block.payload.markdown);
  if (!markdown) return null;
  return (
    <div>
      {str(block.payload.title) ? <h3 className="mb-3 text-h4 font-bold text-ink">{str(block.payload.title)}</h3> : null}
      <Markdown>{markdown}</Markdown>
    </div>
  );
}

const CALLOUT_TONE = { INFO: "info", SUCCESS: "success", WARNING: "warning", DANGER: "danger" } as const;

export function CalloutBlock({ block }: { block: Block }) {
  const markdown = str(block.payload.markdown);
  if (!markdown) return null;
  const tone = CALLOUT_TONE[(str(block.payload.tone) ?? "INFO") as keyof typeof CALLOUT_TONE] ?? "info";
  return (
    <Alert tone={tone} title={str(block.payload.title) ?? "Aviso del evento"}>
      <Markdown className="text-body-sm">{markdown}</Markdown>
    </Alert>
  );
}

export function Faq({ blocks }: { blocks: Block[] }) {
  const items = blocks.flatMap((block) => list(block.payload.items));
  return (
    <div className="divide-y divide-divider rounded-card border border-divider bg-paper-raised">
      {items.map((item, index) => {
        const question = str(item.question);
        const answer = str(item.answer_markdown);
        if (!question || !answer) return null;
        return (
          <details key={index} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {question}
              <ChevronDown className="size-5 shrink-0 text-ink-60 transition-transform duration-control ease-standard group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="px-5 pb-5">
              <Markdown className="text-body-sm">{answer}</Markdown>
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function Documents({ blocks }: { blocks: Block[] }) {
  return (
    <ul className="grid gap-3">
      {blocks.map((block) => {
        const href = str(block.payload.url) ? safeMarkdownUrl(str(block.payload.url) as string) : null;
        const label = str(block.payload.label);
        if (!href || !label) return null;
        return (
          <li key={block.event_content_block_id}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              className="flex items-start gap-3 rounded-card border border-divider bg-paper-raised p-4 transition-colors duration-fast ease-standard hover:border-ink-60"
            >
              <FileText className="mt-0.5 size-5 shrink-0 text-ink-60" aria-hidden="true" />
              <span className="flex-1">
                <span className="font-semibold text-ink">{label}</span>
                {str(block.payload.description) ? <span className="block text-body-sm text-ink-80">{str(block.payload.description)}</span> : null}
              </span>
              <ExternalLink className="size-4 shrink-0 text-ink-60" aria-hidden="true" />
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function Sponsors({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-5">
      {blocks.map((block) => {
        const sponsors = list(block.payload.sponsors);
        return (
          <div key={block.event_content_block_id}>
            {str(block.payload.title) ? <h3 className="mb-3 text-label font-semibold text-ink-60">{str(block.payload.title)}</h3> : null}
            <ul className="flex flex-wrap gap-2">
              {sponsors.map((sponsor, index) => {
                const name = str(sponsor.name);
                if (!name) return null;
                const href = str(sponsor.url) ? safeMarkdownUrl(str(sponsor.url) as string) : null;
                return (
                  <li key={index}>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className="inline-flex min-h-11 items-center rounded-control border border-divider bg-paper-raised px-4 font-display text-h4 font-bold text-ink hover:border-ink-60">
                        {name}
                      </a>
                    ) : (
                      <span className="inline-flex min-h-11 items-center rounded-control border border-divider bg-paper-raised px-4 font-display text-h4 font-bold text-ink">{name}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function Contact({ whatsappUrl }: { whatsappUrl: string | null }) {
  return (
    <div className="flex flex-col gap-4 rounded-card border border-divider bg-paper-raised p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <MessageCircle className="mt-0.5 size-6 shrink-0 text-ink-60" aria-hidden="true" />
        <p className="text-body text-ink-80">
          {whatsappUrl ? "¿Tienes preguntas sobre esta carrera? Escríbele al equipo RUNIIS por WhatsApp." : "El canal de contacto de este evento está en configuración. Mientras tanto, visita la página de contacto."}
        </p>
      </div>
      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-control border border-control bg-paper-raised px-4 text-button font-semibold text-ink hover:border-ink-60"
        >
          Escribir por WhatsApp
          <span className="sr-only">(se abre en otra pestaña)</span>
        </a>
      ) : (
        <Link href="/contacto" className="inline-flex h-11 shrink-0 items-center justify-center rounded-control border border-control px-4 text-button font-semibold text-ink hover:border-ink-60">
          Ir a contacto
        </Link>
      )}
    </div>
  );
}
