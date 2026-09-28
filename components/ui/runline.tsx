import React from "react";
import { cn } from "@/lib/client/cn";

type RunlineProps = {
  /** 2px is the "normal" weight (Tabs/Countdown), 4px is "strong" (Stepper track, pass detail). */
  weight?: "normal" | "strong";
  tone?: "signal" | "neutral";
  className?: string;
};

/**
 * ui-spec §5.3: a Runline is a rounded-cap accent bar, never a repeating ornament, never a table
 * divider. This is the raw primitive; Tabs/Stepper/CountdownStatus compose it with their own layout.
 */
export function Runline({ weight = "normal", tone = "signal", className }: RunlineProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-full",
        weight === "normal" ? "h-[2px]" : "h-[4px]",
        tone === "signal" ? "bg-lime" : "bg-divider",
        className,
      )}
    />
  );
}
