"use client";

import React from "react";
import dynamic from "next/dynamic";
import { MapPinOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { RouteMapPoi } from "@/components/public/event/route-map-canvas";

const RouteMapCanvas = dynamic(() => import("@/components/public/event/route-map-canvas"), { ssr: false });

type Status = "waiting" | "loading" | "ready" | "failed";

/**
 * ui-spec §3.10 RouteMap: MapLibre is fetched only when the map area approaches the viewport. If
 * the style/tiles fail (or never load), the canvas area is replaced by a plain notice; the route's
 * structured text summary (rendered by the page, always present) carries the information either way.
 */
export function RouteMap({ label, coordinates, pois }: { label: string; coordinates: [number, number][]; pois: RouteMapPoi[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [status, setStatus] = React.useState<Status>("waiting");

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStatus((current) => (current === "waiting" ? "loading" : current));
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const onStatus = React.useCallback((next: "ready" | "failed") => setStatus(next), []);

  if (status === "failed") {
    return (
      <div role="status" data-testid="route-map-fallback" className="flex items-start gap-3 rounded-card border border-divider bg-paper-sunken p-5">
        <MapPinOff className="mt-0.5 size-6 shrink-0 text-ink-60" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ink">El mapa no está disponible en este momento</p>
          <p className="mt-1 text-body-sm text-ink-80">Abajo tienes la distancia, la salida, la meta y los puntos de la ruta.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      aria-busy={status !== "ready" || undefined}
      data-testid="route-map"
      data-status={status}
      className="relative aspect-4/3 overflow-hidden rounded-card border border-divider bg-paper-sunken sm:aspect-video"
    >
      {status === "waiting" || status === "loading" ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
      {status !== "waiting" ? <RouteMapCanvas label={label} coordinates={coordinates} pois={pois} onStatus={onStatus} /> : null}
    </div>
  );
}
