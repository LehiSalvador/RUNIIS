"use client";

import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/client/cn";

/** ui-spec §3.1 Tabs: 44px triggers, active-tab Runline underline (2px signal) sliding 150ms between
 * tabs; under reduced motion the global rule makes it jump. Selection is also conveyed by
 * aria-selected (Radix) and a weight change, never by the underline alone. Before hydration each
 * active trigger draws its own static underline, so there is no unstyled first paint. */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      setIndicator(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    measure();

    const mutations = new MutationObserver(measure);
    mutations.observe(list, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
    const resizes = new ResizeObserver(measure);
    resizes.observe(list);

    return () => {
      mutations.disconnect();
      resizes.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-indicator={indicator ? "ready" : undefined}
      className={cn("group/tabs relative flex gap-6 border-b border-divider", className)}
      {...props}
    >
      {children}
      {indicator ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-px left-0 h-[2px] rounded-full bg-lime transition-[transform,width] duration-control ease-standard"
          style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
        />
      ) : null}
    </TabsPrimitive.List>
  );
}

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "group relative flex min-h-11 shrink-0 items-center whitespace-nowrap text-body text-ink-60 transition-colors duration-control ease-standard hover:text-ink",
      "data-[state=active]:font-semibold data-[state=active]:text-ink",
      "disabled:cursor-not-allowed disabled:text-ink-35",
      className,
    )}
    {...props}
  >
    {children}
    <span
      aria-hidden="true"
      className="absolute inset-x-0 -bottom-px hidden h-[2px] rounded-full bg-lime group-data-[state=active]:block group-data-[indicator=ready]/tabs:hidden!"
    />
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = TabsPrimitive.Content;
