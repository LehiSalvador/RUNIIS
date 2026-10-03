import React from "react";
import Link from "next/link";
import { ChevronRight, ChevronsLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/client/cn";

/**
 * Keyboard-friendly cursor pagination for server-rendered admin lists: plain links (no JS needed), the
 * cursor lives in the URL so back/forward/share work. `firstHref` is shown only when already past the
 * first page; `nextHref` only when the API returned a next cursor. Renders nothing for a single page.
 */
export function CursorPager({
  shown,
  nextHref,
  firstHref,
  noun = "resultados",
  className,
}: {
  shown: number;
  nextHref: string | null;
  firstHref: string | null;
  noun?: string;
  className?: string;
}) {
  if (!nextHref && !firstHref) return null;
  return (
    <nav aria-label="Paginación" className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-caption text-ink-60">
        Mostrando {shown} {noun}
        {firstHref ? " de esta página" : ""}
      </p>
      <div className="flex gap-2">
        {firstHref ? (
          <Link href={firstHref} prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <ChevronsLeft className="size-4" aria-hidden="true" />
            Primera página
          </Link>
        ) : null}
        {nextHref ? (
          <Link href={nextHref} prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Siguiente página
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
