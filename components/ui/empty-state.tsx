import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 + §5.2: single Lucide icon 40-48px ink-60, title, one line body, optional CTA.
 * Icon hidden from screen readers; heading is a real heading level (caller passes `headingLevel`
 * to fit the surrounding document outline). Never shares copy across variants (S56). */
export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  headingLevel?: "h2" | "h3" | "h4";
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  headingLevel = "h3",
  className,
}: EmptyStateProps) {
  const Heading = headingLevel;

  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <Icon className="size-11 text-ink-60" aria-hidden="true" />
      <Heading className="text-h4 font-body font-bold text-ink">{title}</Heading>
      {description ? <p className="max-w-sm text-body-sm text-ink-60">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
