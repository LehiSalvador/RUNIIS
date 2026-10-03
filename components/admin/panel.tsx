import React from "react";
import Link from "next/link";
import { cn } from "@/lib/client/cn";

/** Titled card section. `headingLevel` fits the page outline (the shell already owns the h1). */
export function Panel({
  title,
  description,
  actions,
  headingLevel = "h2",
  className,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  headingLevel?: "h2" | "h3";
  className?: string;
  children: React.ReactNode;
}) {
  const Heading = headingLevel;
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn("rounded-card border border-divider bg-paper-raised", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-divider px-4 py-3">
        <div className="min-w-0">
          <Heading id={id} className="text-body font-bold text-ink">
            {title}
          </Heading>
          {description ? <p className="text-caption text-ink-60">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Dense label/value grid (dl) for object overviews. */
export function DefinitionList({
  items,
  columns = 2,
}: {
  items: readonly { label: string; value: React.ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-caption text-ink-60">{item.label}</dt>
          <dd className="break-words text-body-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Dashboard stat tile (ui-spec §4.10): value in display-num, links through to the full surface (a tile is
 * never the source of truth). Without `href` it renders as a plain block.
 */
export function StatTile({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-label font-semibold text-ink-60">{label}</p>
      <p className="mt-1 font-display text-h3 font-bold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-caption text-ink-60">{hint}</p> : null}
    </>
  );
  const base = "block rounded-card border border-divider bg-paper-raised p-4";
  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(base, "transition-colors duration-fast ease-standard hover:border-ink-60")}
    >
      {body}
    </Link>
  );
}
