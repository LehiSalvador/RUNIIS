import React from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, Route, Tag } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { StatusBadge } from "@/components/ui/status-badge";
import { EventCover } from "@/components/public/event-cover";
import {
  formatShortDate,
  publicStatus,
  summarizeDistance,
  summarizePrice,
  type AvailabilityState,
  type ExecutionState,
  type ModalitySummary,
  type RegistrationState,
} from "@/lib/shared/public-event";

export type EventCardData = {
  edition_id: string;
  slug: string;
  name: string;
  city: string;
  state_region: string;
  sport_date: string | null;
  registration_state: RegistrationState;
  execution_state: ExecutionState;
  availability: { global_state: AvailabilityState } | null;
  modality_summary: ModalitySummary;
  image: { storage_object_key: string; alt_text: string } | null;
};

/** Master §57 Event Card: image, name, date, location, modality/distance, price, state, "Ver carrera". */
export function EventCard({
  card,
  headingLevel = "h3",
  priority,
  className,
}: {
  card: EventCardData;
  headingLevel?: "h2" | "h3";
  priority?: boolean;
  className?: string;
}) {
  const Heading = headingLevel;
  const status = publicStatus(card.registration_state, card.execution_state, card.availability?.global_state ?? null);
  const distance = summarizeDistance(card.modality_summary);
  const rangeOnly = distance.replace(/^\d+ modalidades · /, "");

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-card border border-divider bg-paper-raised transition-colors duration-fast ease-standard hover:border-ink-60 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ink",
        className,
      )}
    >
      <EventCover
        image={card.image}
        sportDate={card.sport_date}
        distanceLabel={rangeOnly}
        variant="card"
        priority={priority}
        overlay={<StatusBadge state={status.state} label={status.label} className="bg-paper-raised/95" />}
      />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        <Heading className="text-h4 font-body font-bold text-ink">
          <Link
            href={`/eventos/${card.slug}`}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-hover:underline group-hover:decoration-lime-deep group-hover:underline-offset-4"
          >
            {card.name}
          </Link>
        </Heading>
        <dl className="grid gap-2 text-body-sm text-ink-80">
          <div className="flex items-start gap-2">
            <dt className="mt-0.5 shrink-0">
              <CalendarDays className="size-4 text-ink-60" aria-hidden="true" />
              <span className="sr-only">Fecha</span>
            </dt>
            <dd className="tabular-nums">{card.sport_date ? formatShortDate(card.sport_date) : "Fecha por confirmar"}</dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="mt-0.5 shrink-0">
              <MapPin className="size-4 text-ink-60" aria-hidden="true" />
              <span className="sr-only">Ubicación</span>
            </dt>
            <dd>
              {card.city}, {card.state_region}
            </dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="mt-0.5 shrink-0">
              <Route className="size-4 text-ink-60" aria-hidden="true" />
              <span className="sr-only">Modalidades y distancia</span>
            </dt>
            <dd className="tabular-nums">{distance}</dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="mt-0.5 shrink-0">
              <Tag className="size-4 text-ink-60" aria-hidden="true" />
              <span className="sr-only">Precio</span>
            </dt>
            <dd className="tabular-nums">{summarizePrice(card.modality_summary)}</dd>
          </div>
        </dl>
        <span aria-hidden="true" className="mt-auto inline-flex items-center gap-1.5 pt-1 text-button font-semibold text-ink">
          Ver carrera
          <ArrowRight className="size-4 transition-transform duration-fast ease-standard group-hover:translate-x-0.5" />
        </span>
      </div>
    </article>
  );
}
