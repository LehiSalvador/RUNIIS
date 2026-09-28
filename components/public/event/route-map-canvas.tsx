"use client";

import React from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Loaded only through next/dynamic from route-map.tsx (ADR-001: MapLibre never in the initial public
// bundle). SEC-063 text-only sinks: nothing editor-provided reaches the map as HTML -- no popups, no
// HTML markers; POIs are plain circle features and their names live in the text summary instead.

export const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";
const LOAD_TIMEOUT_MS = 12_000;
// Same-origin copy of the package worker (app/(public)/vendor/maplibre/[file]/route.ts).
const WORKER_PATH = "/vendor/maplibre/maplibre-gl-worker.mjs";

const LOCALE = {
  "AttributionControl.ToggleAttribution": "Mostrar u ocultar atribución",
  "Map.Title": "Mapa",
  "NavigationControl.ResetBearing": "Restablecer orientación al norte",
  "NavigationControl.ZoomIn": "Acercar",
  "NavigationControl.ZoomOut": "Alejar",
  "CooperativeGesturesHandler.WindowsHelpText": "Usa Ctrl + desplazamiento para acercar el mapa",
  "CooperativeGesturesHandler.MacHelpText": "Usa ⌘ + desplazamiento para acercar el mapa",
  "CooperativeGesturesHandler.MobileHelpText": "Usa dos dedos para mover el mapa",
};

export type RouteMapPoi = { poi_type: string; longitude: number; latitude: number };

export default function RouteMapCanvas({
  label,
  coordinates,
  pois,
  onStatus,
}: {
  label: string;
  coordinates: [number, number][];
  pois: RouteMapPoi[];
  onStatus: (status: "ready" | "failed") => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const onStatusRef = React.useRef(onStatus);
  React.useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || coordinates.length < 2) return;
    let settled = false;
    const settle = (status: "ready" | "failed") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      onStatusRef.current(status);
    };
    const timer = window.setTimeout(() => settle("failed"), LOAD_TIMEOUT_MS);

    const bounds = coordinates.reduce(
      (acc, point) => acc.extend(point),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );

    let map: maplibregl.Map;
    try {
      maplibregl.setWorkerUrl(new URL(WORKER_PATH, window.location.origin).href);
      map = new maplibregl.Map({
        container,
        style: MAP_STYLE_URL,
        bounds,
        fitBoundsOptions: { padding: 40 },
        attributionControl: { compact: true },
        cooperativeGestures: true,
        locale: LOCALE,
        maxZoom: 17,
      });
    } catch {
      settle("failed");
      return () => window.clearTimeout(timer);
    }

    map.getCanvas().setAttribute("aria-label", label);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("error", () => {
      if (!map.loaded()) settle("failed");
    });
    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } } });
      map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4B6B12", "line-width": 8 } });
      map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0B0D0E", "line-width": 4 } });
      map.addSource("pois", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: pois.map((poi) => ({
            type: "Feature",
            properties: { kind: poi.poi_type === "START" || poi.poi_type === "FINISH" ? "edge" : "poi" },
            geometry: { type: "Point", coordinates: [poi.longitude, poi.latitude] },
          })),
        },
      });
      map.addLayer({
        id: "pois",
        type: "circle",
        source: "pois",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "edge", 8, 6],
          "circle-color": ["match", ["get", "kind"], "edge", "#D7FF3F", "#FFFFFF"],
          "circle-stroke-color": "#0B0D0E",
          "circle-stroke-width": 2,
        },
      });
      // The container can change size after construction (stylesheet arrival, layout); refit so the
      // whole route is always in view.
      map.resize();
      map.fitBounds(bounds, { padding: 40, duration: 0 });
      settle("ready");
    });

    return () => {
      window.clearTimeout(timer);
      map.remove();
    };
  }, [coordinates, pois, label]);

  // maplibre-gl.css makes the container position:relative, so it fills an absolute wrapper instead.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
