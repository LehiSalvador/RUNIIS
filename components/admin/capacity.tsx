import React from "react";
import { z } from "zod";
import { cn } from "@/lib/client/cn";

/**
 * Capacity summary for an Edition, read from `availability` of the admin editor projection
 * (private.edition_availability: derived from CONFIRMED registrations + active holds, never a stored
 * counter). The API types it as an open record, so it is parsed defensively here: an unexpected shape
 * renders "Cupo no disponible" instead of breaking the page.
 */
const count = z.number().int().nonnegative();
const state = z.string();

const globalSchema = z.object({
  capacity: count.nullable(),
  confirmed: count,
  active_holds: count,
  available: count.nullable(),
  state,
});

const availabilitySchema = z.object({
  global: globalSchema,
  modalities: z
    .array(
      z.object({
        modality_id: z.string(),
        status: z.string(),
        effective_capacity: count.nullable(),
        confirmed: count,
        active_holds: count,
        available: count.nullable(),
        state,
      }),
    )
    .default([]),
});

export type CapacityView = z.output<typeof availabilitySchema>;

export function parseAvailability(raw: unknown): CapacityView | null {
  const parsed = availabilitySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const STATE_LABEL: Record<string, string> = {
  AVAILABLE: "Disponible",
  LOW: "Pocos lugares",
  TEMPORARILY_UNAVAILABLE: "Agotado por apartados",
  SOLD_OUT: "Agotado",
};

export function capacityStateLabel(value: string): string {
  return STATE_LABEL[value] ?? value;
}

/** Occupied share (confirmed + holds over capacity) in whole percent, or null without a capacity. */
export function occupancyPercent(capacity: number | null, confirmed: number, holds: number): number | null {
  if (capacity === null || capacity <= 0) return null;
  return Math.min(100, Math.round(((confirmed + holds) / capacity) * 100));
}

function Meter({ percent, label }: { percent: number; label: string }) {
  const tone = percent >= 100 ? "bg-danger" : percent >= 85 ? "bg-warning" : "bg-lime-deep";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 w-full overflow-hidden rounded-full bg-paper-sunken"
    >
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${percent}%` }} />
    </div>
  );
}

function Row({
  name,
  capacity,
  confirmed,
  holds,
  available,
  stateText,
}: {
  name: string;
  capacity: number | null;
  confirmed: number;
  holds: number;
  available: number | null;
  stateText: string;
}) {
  const percent = occupancyPercent(capacity, confirmed, holds);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <p className="text-body-sm font-semibold text-ink">{name}</p>
        <p className="text-caption text-ink-60">{stateText}</p>
      </div>
      {percent !== null ? <Meter percent={percent} label={`Ocupación de ${name}`} /> : null}
      <p className="text-caption tabular-nums text-ink-80">
        Capacidad {capacity ?? "sin límite"} · Confirmados {confirmed} · Apartados {holds} · Libres {available ?? "—"}
      </p>
    </div>
  );
}

export function CapacitySummary({
  availability,
  modalityNames,
}: {
  availability: unknown;
  /** modality_id -> display name, from the same editor projection. */
  modalityNames: Readonly<Record<string, string>>;
}) {
  const view = parseAvailability(availability);
  if (!view) {
    return <p className="text-body-sm text-ink-60">Cupo no disponible por ahora. Actualiza la pantalla para reintentar.</p>;
  }
  const { global } = view;
  return (
    <div className="flex flex-col gap-4">
      <Row
        name="Total de la edición"
        capacity={global.capacity}
        confirmed={global.confirmed}
        holds={global.active_holds}
        available={global.available}
        stateText={capacityStateLabel(global.state)}
      />
      {view.modalities.length > 0 ? (
        <ul className="flex flex-col gap-4 border-t border-divider pt-4">
          {view.modalities.map((modality) => (
            <li key={modality.modality_id}>
              <Row
                name={modalityNames[modality.modality_id] ?? "Modalidad"}
                capacity={modality.effective_capacity}
                confirmed={modality.confirmed}
                holds={modality.active_holds}
                available={modality.available}
                stateText={modality.status === "ACTIVE" ? capacityStateLabel(modality.state) : modality.status === "CLOSED" ? "Cerrada" : "Cancelada"}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
