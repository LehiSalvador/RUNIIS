import React from "react";
import { cn } from "@/lib/client/cn";

/** Account page block: a results-sheet style section (1px divider rule, Archivo h2, optional action). */
export function AccountSection({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("border-t border-divider pt-6", className)}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-[var(--container-reading)]">
          <h2 id={headingId} className="font-display text-h3 font-bold text-ink">
            {title}
          </h2>
          {description ? <p className="mt-1 text-body-sm text-ink-60">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Bordered list container: rows separated by the divider token, never by shadows. */
export function RowList({ children, label, className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("divide-y divide-divider rounded-card border border-divider bg-paper-raised", className)}>
      {children}
    </ul>
  );
}

/** Label/value pair for read-only data (definition list row). */
export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <dt className="text-caption font-semibold text-ink-60">{label}</dt>
      <dd className="text-body text-ink">{children}</dd>
    </div>
  );
}

/** ui-spec §3.5 kind pill: neutral category, not a status. */
export function KindBadge({ kind, label }: { kind: "PROFILE" | "GUEST"; label?: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-paper-sunken px-2.5 py-0.5 text-caption font-semibold text-ink-80">
      {label ?? (kind === "GUEST" ? "Invitado" : "Cuenta")}
    </span>
  );
}
