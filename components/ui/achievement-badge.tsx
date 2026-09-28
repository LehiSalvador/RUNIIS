import React from "react";
import { History, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * ui-spec §3.8 AchievementBadge: fixed-size icon tile, radius-card, name label beneath. ACTIVE is
 * full ink-on-paper-raised with a lime-deep thin border. REVOKED never renders on a public profile
 * (no `revoked` variant is exposed there -- callers simply omit revoked grants from that list). The
 * admin Community Admin surface needs the revoked-with-reason variant for reconciliation review:
 * desaturated ink-60 tile with a history icon opening the audit trail (`onOpenHistory`) -- ink-35
 * is reserved for genuinely disabled controls (ui-spec §2.2 exempts it from AA only there), so this
 * static/enabled content uses ink-60 (5.19:1, passes AA) instead.
 */
export type AchievementBadgeProps = {
  icon: LucideIcon;
  name: string;
  variant?: "active" | "admin-revoked";
  onOpenHistory?: () => void;
  className?: string;
};

export function AchievementBadge({ icon: Icon, name, variant = "active", onOpenHistory, className }: AchievementBadgeProps) {
  const isRevoked = variant === "admin-revoked";

  return (
    <div className={cn("flex w-20 flex-col items-center gap-1.5 text-center", className)}>
      <span
        className={cn(
          "flex size-16 items-center justify-center rounded-card border",
          isRevoked ? "border-divider bg-paper-sunken text-ink-60" : "border-lime-deep bg-paper-raised text-ink",
        )}
      >
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <span className={cn("text-label", isRevoked ? "text-ink-60" : "text-ink")}>
        {name}
        {isRevoked ? <span className="sr-only"> (revocado)</span> : null}
      </span>
      {isRevoked && onOpenHistory ? (
        <button
          type="button"
          onClick={onOpenHistory}
          aria-label={`Ver historial de revocación de ${name}`}
          className="-mt-1 flex size-11 items-center justify-center rounded-control text-ink-60 hover:text-ink"
        >
          <History className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
