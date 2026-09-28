"use client";

import React from "react";
import { cn } from "@/lib/client/cn";
import { EventCta } from "@/components/public/event/availability";

/**
 * ui-spec §4.3 mobile sticky CTA: appears once the inline Level 1 CTA scrolls out above the
 * viewport, repeats the same CTA and price, and is hidden at lg+ where the sticky summary card
 * carries the CTA (never two CTAs on screen at once).
 */
export function StickyCta({ targetId, priceLabel }: { targetId: string; priceLabel: string }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    // A scroll check rather than an IntersectionObserver: a fast fling can jump the inline CTA from
    // below the fold to above it without ever intersecting, which an observer never reports.
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = target.getBoundingClientRect();
      setVisible(rect.height > 0 && rect.bottom < 0);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [targetId]);

  return (
    <div
      data-testid="sticky-cta"
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-sticky-cta border-t border-divider bg-paper-raised/95 shadow-sm backdrop-blur-sm transition-transform duration-panel ease-standard lg:hidden",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      <div className="mx-auto flex max-w-[var(--container-public)] items-center gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <p className="min-w-0 flex-1">
          <span className="block text-caption text-ink-60">Precio</span>
          <span className="block truncate font-display text-h4 font-bold leading-tight tabular-nums text-ink">{priceLabel}</span>
        </p>
        <EventCta size="md" idSuffix="sticky" compact className="w-auto min-w-44 max-w-[60%]" />
      </div>
    </div>
  );
}
