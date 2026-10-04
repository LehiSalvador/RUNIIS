"use client";

import React from "react";
import dynamic from "next/dynamic";
import { MapPinOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { RouteEditorCanvasProps } from "@/components/admin/routes/route-editor-canvas";

const RouteEditorCanvas = dynamic(() => import("@/components/admin/routes/route-editor-canvas"), { ssr: false });

type Status = "loading" | "ready" | "failed";

/**
 * Staff RouteMap (ui-spec §3.10): lazy MapLibre canvas with a text alternative that is ALWAYS present on the page (the summary, the vertex
 * table and the POI list next to it). If the canvas cannot start (no WebGL, worker blocked, timeout), the area says so and the rest of
 * the editor keeps working: every map action has a form or table equivalent.
 */
export function RouteEditorMap(props: Omit<RouteEditorCanvasProps, "onStatus"> & { vertexCount: number }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const onStatus = React.useCallback((next: "ready" | "failed") => setStatus(next), []);
  const { vertexCount, ...canvas } = props;

  if (status === "failed") {
    return (
      <div role="status" data-testid="route-editor-map-fallback" className="flex items-start gap-3 rounded-card border border-divider bg-paper-sunken p-5">
        <MapPinOff className="mt-0.5 size-6 shrink-0 text-ink-60" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ink">El mapa no está disponible en este momento</p>
          <p className="mt-1 text-body-sm text-ink-80">
            Puedes seguir trabajando con la lista de puntos, el formulario de coordenadas y los puntos de interés de abajo; hacen lo mismo que el mapa.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={canvas.label}
      aria-busy={status !== "ready" || undefined}
      data-testid="route-editor-map"
      data-status={status}
      data-tool={canvas.tool}
      data-vertices={vertexCount}
      data-editable={canvas.editable ? "true" : "false"}
      className="relative aspect-4/3 overflow-hidden rounded-card border border-divider bg-paper-sunken sm:aspect-video lg:aspect-[16/10]"
    >
      {status === "loading" ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
      <RouteEditorCanvas {...canvas} onStatus={onStatus} />
    </div>
  );
}
