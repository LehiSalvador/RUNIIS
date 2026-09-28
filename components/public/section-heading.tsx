import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { Runline } from "@/components/ui/runline";

/** Public section header: Archivo Narrow h2 with the 4px signal Runline beneath (ui-spec §5.3
 * "community editorial"), optional trailing link. */
export function SectionHeading({
  id,
  title,
  description,
  action,
  level = "h2",
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: { href: string; label: string };
  level?: "h1" | "h2";
  className?: string;
}) {
  const Heading = level;
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="max-w-2xl">
        <Heading id={id} className={cn("font-display font-bold text-ink", level === "h1" ? "text-h1" : "text-h2")}>
          {title}
        </Heading>
        <Runline weight="strong" className="mt-3 w-16" />
        {description ? <p className="mt-4 text-body-lg text-ink-80">{description}</p> : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-xs text-button font-semibold text-ink underline decoration-divider underline-offset-8 transition-colors duration-fast ease-standard hover:decoration-ink sm:self-auto"
        >
          {action.label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
