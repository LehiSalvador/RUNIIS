"use client";

import React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 Checkbox: 20x20 box radius-xs inside a 44px hit target; the focus ring is drawn on
 * the visible box, not the hit area. Checked fill is ink with a paper glyph, never lime.
 * Indeterminate uses aria-checked=mixed (Radix). Without `label`, pass `aria-label`. */
export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  label?: string;
};

export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const checkbox = (
      <CheckboxPrimitive.Root
        ref={ref}
        id={id}
        className={cn(
          "group flex size-11 shrink-0 items-center justify-center focus-visible:outline-none disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded-xs border border-control bg-paper-raised text-paper transition-colors duration-micro ease-standard",
            "group-data-[state=checked]:border-ink group-data-[state=checked]:bg-ink group-data-[state=indeterminate]:border-ink group-data-[state=indeterminate]:bg-ink",
            "group-data-[disabled]:border-divider group-data-[disabled]:bg-paper-sunken",
            "group-hover:border-ink-60 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring",
          )}
        >
          <CheckboxPrimitive.Indicator className="flex items-center justify-center">
            {props.checked === "indeterminate" ? (
              <Minus className="size-3.5" aria-hidden="true" />
            ) : (
              <Check className="size-3.5" aria-hidden="true" />
            )}
          </CheckboxPrimitive.Indicator>
        </span>
      </CheckboxPrimitive.Root>
    );

    if (!label) return checkbox;

    return (
      <label htmlFor={id} className="inline-flex items-center gap-2 -ml-2">
        {checkbox}
        <span className={cn("text-body", props.disabled ? "text-ink-35" : "text-ink")}>{label}</span>
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
