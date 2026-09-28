import React from "react";
import Link from "next/link";
import { cn } from "@/lib/client/cn";
import { Runline } from "@/components/ui/runline";

/**
 * ui-spec §6: text-only RUNIIS lockup, Archivo Narrow 700, letter-spacing -0.01em, no invented
 * symbol/logo (PEND-BRAND-001). A single 2px signal Runline runs the full width directly beneath
 * it. `surface` picks ink-on-paper vs paper-on-ink text so it stays legible on the ink-surface
 * footer/scanner contexts (ui-spec §2.2 ink/lime and lime/ink pairs).
 */
export function Wordmark({
  surface = "light",
  size = "header",
  href = "/",
  className,
}: {
  surface?: "light" | "ink";
  size?: "header" | "large";
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex min-h-11 flex-col justify-center rounded-xs", className)}
      aria-label="RUNIIS, ir al inicio"
    >
      <span
        className={cn(
          "font-display font-bold tracking-[-0.01em]",
          size === "header" ? "text-[22px] leading-none sm:text-[26px]" : "text-h1",
          surface === "ink" ? "text-paper" : "text-ink",
        )}
      >
        RUNIIS
      </span>
      <Runline weight="normal" tone="signal" className="mt-1 w-full" />
    </Link>
  );
}
