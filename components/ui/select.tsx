"use client";

import React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 Select: trigger + listbox, Radix Select semantics (role listbox), shadow-md,
 * radius-control. The listbox uses the `z-popover` layer (above modal/drawer, below toast) because
 * Selects live inside dialogs (e.g. guardian verification); the §2.9 `dropdown` layer would render
 * it underneath the open dialog. */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
/** Radix quirk: the trigger's label text is only captured once SelectContent has mounted (i.e.
 * after the listbox has opened at least once) -- it is NOT derived from `defaultValue`/`value`
 * alone on first closed render. When the initial value is already known, pass its label as
 * children (`<SelectValue placeholder="...">{knownLabel}</SelectValue>`) instead of relying on the
 * automatic lookup, or the trigger renders blank until the user opens it once. */
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { invalid?: boolean }
>(({ className, children, invalid, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "flex h-11 w-full items-center justify-between gap-2 rounded-control border bg-paper-raised px-4 text-body text-ink transition-colors duration-fast ease-standard data-[placeholder]:text-ink-60",
      invalid ? "border-danger" : "border-control hover:border-ink-60 data-[state=open]:border-ink",
      "disabled:cursor-not-allowed disabled:border-divider disabled:bg-paper-sunken disabled:text-ink-35",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 shrink-0 text-ink-60" aria-hidden="true" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", sideOffset = 4, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={position === "popper" ? sideOffset : undefined}
      className={cn(
        "z-popover overflow-hidden rounded-control border border-divider bg-paper-raised shadow-md",
        position === "popper" &&
          "max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex h-11 cursor-pointer select-none items-center rounded-xs px-3 pr-8 text-body text-ink outline-none data-[highlighted]:bg-paper-sunken data-[disabled]:pointer-events-none data-[disabled]:text-ink-35",
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-3 flex items-center">
      <Check className="size-4" aria-hidden="true" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";
