import React from "react";
import { cn } from "@/lib/client/cn";
import { Avatar } from "@/components/ui/avatar";

/**
 * ui-spec §3.7 RankingRow (an <li>; wrap rows in <RankingList>): display-num rank, 32px avatar, name,
 * primary metric in display-num tabular. A 3px lime-deep left bar marks only the current viewer's row,
 * also stated in text for screen readers. Ties are the caller's job: pass competition ranks (1,1,3),
 * never renumbered, with `tied` so the rows read as a shared position.
 */
export type RankingRowData = {
  id: string;
  rank: number;
  displayName: string;
  avatarSrc?: string | null;
  metricLabel: string;
  metricValue: string;
  isCurrentViewer?: boolean;
  tied?: boolean;
};

export function RankingList({ className, children, "aria-label": ariaLabel }: { className?: string; children: React.ReactNode; "aria-label"?: string }) {
  return (
    <ol aria-label={ariaLabel} className={cn("divide-y divide-divider", className)}>
      {children}
    </ol>
  );
}

export function RankingRow({
  rank,
  displayName,
  avatarSrc,
  metricLabel,
  metricValue,
  isCurrentViewer,
  tied,
  size = "default",
}: RankingRowData & { size?: "default" | "podium" }) {
  const podium = size === "podium";
  return (
    <li
      className={cn(
        "flex min-h-14 items-center gap-3 py-3 pr-4 sm:gap-4",
        isCurrentViewer ? "border-l-[3px] border-l-lime-deep pl-[13px]" : "pl-4",
      )}
    >
      <span className={cn("w-10 shrink-0 font-display font-bold tabular-nums text-ink", podium ? "text-h2" : "text-h4")}>
        {rank}
      </span>
      <Avatar src={avatarSrc} displayName={displayName} size={podium ? 40 : 32} decorative />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-ink">{displayName}</span>
        {tied || isCurrentViewer ? (
          <span className="block text-caption text-ink-60">
            {[tied ? "Empate" : null, isCurrentViewer ? "Tu posición" : null].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right">
        <span className={cn("block font-display font-bold tabular-nums text-ink", podium ? "text-h3" : "text-h4")}>
          {metricValue}
        </span>
        <span className="block text-caption text-ink-60">{metricLabel}</span>
      </span>
    </li>
  );
}
