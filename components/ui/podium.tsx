import React from "react";
import { cn } from "@/lib/client/cn";
import { Avatar } from "@/components/ui/avatar";
import { RankingList, RankingRow, type RankingRowData } from "@/components/ui/ranking-row";
import { Alert } from "@/components/ui/alert";
import { arrangePodium, type PodiumPlace } from "@/lib/client/podium";

/**
 * ui-spec §3.7 Podium. Pedestal layout (center tallest) for up to three occupants of ranks 1-3,
 * a podium-scale ranked list once ties push more than three people in (lib/client/podium.ts).
 * DOM order is finishing order; the 2-1-3 visual order is set by grid columns only. OPEN/CONSOLIDATING periods
 * always carry the "Proyección, no resultado oficial" banner; CLOSED shows the frozen snapshot date.
 */
export type PodiumOccupant = RankingRowData;

export type PodiumProps = {
  occupants: PodiumOccupant[];
  periodStatus: "OPEN" | "CONSOLIDATING" | "CLOSED";
  /** Already formatted snapshot date for CLOSED periods, e.g. "31 de agosto de 2026". */
  snapshotDate?: string;
  className?: string;
};

const PLACE_CLASS: Record<PodiumPlace, string> = {
  first: "col-start-2 row-start-1 pt-6 pb-10 sm:pb-14",
  second: "col-start-1 row-start-1 pt-4 pb-6 sm:pb-8",
  third: "col-start-3 row-start-1 pt-4 pb-4 sm:pb-6",
};

export function Podium({ occupants, periodStatus, snapshotDate, className }: PodiumProps) {
  const layout = arrangePodium(occupants);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {periodStatus !== "CLOSED" ? (
        <Alert tone="info" title="Proyección, no resultado oficial" />
      ) : snapshotDate ? (
        <p className="text-caption text-ink-60">Resultado oficial al {snapshotDate}</p>
      ) : null}

      {layout.mode === "list" ? (
        <RankingList aria-label="Podio" className="rounded-card border border-divider bg-paper-raised">
          {layout.rows.map((occupant) => (
            <RankingRow key={occupant.id} {...occupant} size="podium" />
          ))}
        </RankingList>
      ) : (
        <ol aria-label="Podio" className="grid grid-cols-3 items-end gap-2 sm:gap-3">
          {layout.slots.map(({ occupant, place }) => (
            <li
              key={occupant.id}
              className={cn(
                "flex min-w-0 flex-col items-center gap-2 rounded-card border border-divider bg-paper-raised px-2 text-center sm:px-4",
                PLACE_CLASS[place],
                occupant.isCurrentViewer && "border-2 border-lime-deep",
              )}
            >
              <Avatar src={occupant.avatarSrc} displayName={occupant.displayName} size={place === "first" ? 64 : 40} decorative />
              <span className="w-full truncate text-body-sm font-semibold text-ink">{occupant.displayName}</span>
              <span
                className={cn(
                  "font-display font-bold leading-none tabular-nums text-ink",
                  place === "first" ? "text-display-xl" : "text-h2",
                )}
              >
                <span className="sr-only">Posición </span>
                {occupant.rank}
              </span>
              <span className="text-caption tabular-nums text-ink-60">
                {occupant.metricValue} {occupant.metricLabel}
              </span>
              {occupant.isCurrentViewer ? <span className="text-caption font-semibold text-lime-deep">Tu posición</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
