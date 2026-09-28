"use client";

import React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 Radio: 20x20 circle, 44px hit target, selected = ink ring + ink center dot.
 * role=radiogroup/radio with native Radix arrow-key navigation. */
export const RadioGroup = RadioGroupPrimitive.Root;

export type RadioItemProps = React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & {
  label?: string;
};

export const RadioItem = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Item>, RadioItemProps>(
  ({ className, label, id, ...props }, ref) => {
    const radio = (
      <RadioGroupPrimitive.Item
        ref={ref}
        id={id}
        className={cn(
          "group flex size-11 shrink-0 items-center justify-center focus-visible:outline-none disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <span className="flex size-5 items-center justify-center rounded-full border border-control bg-paper-raised transition-colors duration-micro ease-standard group-hover:border-ink-60 group-data-[state=checked]:border-ink group-data-[disabled]:border-divider group-data-[disabled]:bg-paper-sunken group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring">
          <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-ink group-data-[disabled]:bg-ink-35" />
        </span>
      </RadioGroupPrimitive.Item>
    );

    if (!label) return radio;

    return (
      <label htmlFor={id} className="inline-flex items-center gap-2 -ml-2">
        {radio}
        <span className={cn("text-body", props.disabled ? "text-ink-35" : "text-ink")}>{label}</span>
      </label>
    );
  },
);
RadioItem.displayName = "RadioItem";
