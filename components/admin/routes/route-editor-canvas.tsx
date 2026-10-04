"use client";

import React from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { boundsOf, nearestSegment, type LonLat, type PoiType } from "@/components/admin/routes/route-geometry";

// Loaded only through next/dynamic from route-editor-map.tsx (MapLibre never reaches the initial staff bundle). Same stack as the public
// event map (components/public/event/route-map-canvas.tsx): MapLibre GL with the same-origin worker served by app/(public)/vendor/maplibre.
// SEC-063 text-only sinks: nothing editor-provided reaches the map as HTML (no popups, no HTML markers, no labels): POI names live in the
// text list next to the map.
//
// BASEMAP: the staff pages run under the nonce CSP (proxy.ts buildCsp), whose connect-src is 'self' only, so the OpenFreeMap tiles the
// public page uses cannot be fetched here. The editor therefore draws on a plain paper background (route, vertices, POIs and a scale bar
// are all it needs to edit a trace) and uses the shared style only when NEXT_PUBLIC_ADMIN_MAP_BASEMAP=1, i.e. once the CSP allows the
// tile origin for the staff routes. No new provider, key or tile service is introduced either way.

const SHARED_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";
const USE_SHARED_BASEMAP = process.env.NEXT_PUBLIC_ADMIN_MAP_BASEMAP === "1";
const LOAD_TIMEOUT_MS = 12_000;
const WORKER_PATH = "/vendor/maplibre/maplibre-gl-worker.mjs";
/** Above this many vertices the handles are not drawn (they would be an unreadable cloud); the table and the other tools still edit them. */
export const MAX_VISIBLE_VERTICES = 3000;
const DEFAULT_CENTER: LonLat = [-100.3161, 25.6866];

const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "paper", type: "background", paint: { "background-color": "#ECEEE8" } }],
};

const LOCALE = {
  "AttributionControl.ToggleAttribution": "Mostrar u ocultar atribución",
  "Map.Title": "Mapa",
  "NavigationControl.ResetBearing": "Restablecer orientación al norte",
  "NavigationControl.ZoomIn": "Acercar",
  "NavigationControl.ZoomOut": "Alejar",
  "ScaleControl.Feet": "pies",
  "ScaleControl.Meters": "m",
  "ScaleControl.Kilometers": "km",
  "ScaleControl.Miles": "mi",
  "ScaleControl.NauticalMiles": "mn",
  "CooperativeGesturesHandler.WindowsHelpText": "Usa Ctrl + desplazamiento para acercar el mapa",
  "CooperativeGesturesHandler.MacHelpText": "Usa ⌘ + desplazamiento para acercar el mapa",
  "CooperativeGesturesHandler.MobileHelpText": "Usa dos dedos para mover el mapa",
};

export type MapTool = "view" | "add" | "insert" | "move" | "delete" | "start" | "finish" | "poi";

export type CanvasPoi = { key: string; poi_type: PoiType; longitude: number; latitude: number };

export type RouteEditorCanvasProps = {
  label: string;
  coords: readonly LonLat[];
  pois: readonly CanvasPoi[];
  selected: number | null;
  tool: MapTool;
  /** False for a published revision, the preview and narrow screens: the map only shows. */
  editable: boolean;
  showVertices: boolean;
  /** Increments to ask for a re-fit of the view to the whole route. */
  fitSignal: number;
  /** Increments (with `focusIndex`) to centre the view on one vertex. */
  focusSignal: number;
  focusIndex: number | null;
  onStatus: (status: "ready" | "failed") => void;
  onAdd: (point: LonLat) => void;
  onInsert: (index: number, point: LonLat) => void;
  onMove: (index: number, point: LonLat) => void;
  onDelete: (index: number) => void;
  onSelect: (index: number | null) => void;
  onPlace: (tool: "start" | "finish" | "poi", point: LonLat) => void;
};

// Minimal GeoJSON shapes (the package types are not a direct dependency of the app).
type LineFeature = { type: "Feature"; properties: Record<string, never>; geometry: { type: "LineString"; coordinates: LonLat[] } };
type PointCollection = { type: "FeatureCollection"; features: { type: "Feature"; properties: Record<string, string | number>; geometry: { type: "Point"; coordinates: LonLat } }[] };

function lineFeature(coords: readonly LonLat[]): LineFeature {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords.length >= 2 ? (coords as LonLat[]) : [] } };
}

function vertexCollection(coords: readonly LonLat[], selected: number | null, visible: boolean): PointCollection {
  if (!visible) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: coords.map((point, index) => ({
      type: "Feature",
      properties: { index, role: index === selected ? "selected" : index === 0 ? "first" : index === coords.length - 1 ? "last" : "mid" },
      geometry: { type: "Point", coordinates: point },
    })),
  };
}

function poiCollection(pois: readonly CanvasPoi[]): PointCollection {
  return {
    type: "FeatureCollection",
    features: pois.map((poi) => ({
      type: "Feature",
      properties: { kind: poi.poi_type === "START" ? "start" : poi.poi_type === "FINISH" ? "finish" : "poi" },
      geometry: { type: "Point", coordinates: [poi.longitude, poi.latitude] },
    })),
  };
}

export default function RouteEditorCanvas(props: RouteEditorCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const propsRef = React.useRef(props);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    propsRef.current = props;
  });

  // ---- create the map once; handlers read the latest props through propsRef
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let settled = false;
    const settle = (status: "ready" | "failed") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      propsRef.current.onStatus(status);
    };
    const timer = window.setTimeout(() => settle("failed"), LOAD_TIMEOUT_MS);

    const initial = propsRef.current;
    const bounds = boundsOf(initial.coords);
    let map: maplibregl.Map;
    try {
      maplibregl.setWorkerUrl(new URL(WORKER_PATH, window.location.origin).href);
      map = new maplibregl.Map({
        container,
        style: USE_SHARED_BASEMAP ? SHARED_STYLE_URL : BLANK_STYLE,
        ...(bounds
          ? { bounds: [bounds.west, bounds.south, bounds.east, bounds.north] as [number, number, number, number], fitBoundsOptions: { padding: 48, maxZoom: 17 } }
          : { center: DEFAULT_CENTER, zoom: 11 }),
        attributionControl: { compact: true },
        cooperativeGestures: true,
        locale: LOCALE,
        maxZoom: 19,
        // The canvas must be readable back for a screenshot of the editing state in tests and support.
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
    } catch {
      settle("failed");
      return () => window.clearTimeout(timer);
    }
    mapRef.current = map;
    map.getCanvas().setAttribute("aria-label", initial.label);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("error", () => {
      if (!map.loaded()) settle("failed");
    });

    map.on("load", () => {
      const current = propsRef.current;
      map.addSource("route", { type: "geojson", data: lineFeature(current.coords) });
      map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4B6B12", "line-width": 8 } });
      map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0B0D0E", "line-width": 4 } });
      map.addSource("vertices", { type: "geojson", data: vertexCollection(current.coords, current.selected, current.showVertices && current.coords.length <= MAX_VISIBLE_VERTICES) });
      map.addLayer({
        id: "vertices",
        type: "circle",
        source: "vertices",
        paint: {
          "circle-radius": ["match", ["get", "role"], "selected", 8, 5],
          "circle-color": ["match", ["get", "role"], "selected", "#D7FF3F", "first", "#FFFFFF", "last", "#FFFFFF", "#FFFFFF"],
          "circle-stroke-color": "#0B0D0E",
          "circle-stroke-width": ["match", ["get", "role"], "selected", 3, 2],
        },
      });
      map.addSource("pois", { type: "geojson", data: poiCollection(current.pois) });
      map.addLayer({
        id: "pois",
        type: "circle",
        source: "pois",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "start", 10, "finish", 10, 7],
          "circle-color": ["match", ["get", "kind"], "start", "#D7FF3F", "finish", "#0B0D0E", "#FFFFFF"],
          "circle-stroke-color": ["match", ["get", "kind"], "finish", "#D7FF3F", "#0B0D0E"],
          "circle-stroke-width": 3,
        },
      });
      map.resize();
      if (bounds) map.fitBounds([bounds.west, bounds.south, bounds.east, bounds.north], { padding: 48, duration: 0, maxZoom: 17 });
      setReady(true);
      settle("ready");
    });

    // ---- interaction
    let dragging: { index: number; coords: LonLat[] } | null = null;
    const toPoint = (event: { lngLat: { lng: number; lat: number } }): LonLat => [event.lngLat.lng, event.lngLat.lat];
    const vertexAt = (point: maplibregl.PointLike): number | null => {
      if (!map.getLayer("vertices")) return null;
      const hit = map.queryRenderedFeatures(point, { layers: ["vertices"] })[0];
      const index = hit?.properties?.index;
      return typeof index === "number" ? index : null;
    };

    map.on("click", (event) => {
      const { tool, editable, coords, onAdd, onInsert, onDelete, onSelect, onPlace } = propsRef.current;
      const hit = vertexAt(event.point);
      if (!editable || tool === "view" || tool === "move") {
        onSelect(hit);
        return;
      }
      if (tool === "delete") {
        if (hit !== null) onDelete(hit);
        return;
      }
      if (hit !== null && (tool === "add" || tool === "insert")) {
        onSelect(hit);
        return;
      }
      const point = toPoint(event);
      if (tool === "add") onAdd(point);
      else if (tool === "insert") {
        const segment = nearestSegment(coords, point);
        if (segment) onInsert(segment.index + 1, point);
      } else onPlace(tool, point);
    });

    const startDrag = (index: number) => {
      const { coords } = propsRef.current;
      dragging = { index, coords: coords.map((point) => [point[0], point[1]] as LonLat) };
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
    };
    const moveDrag = (point: LonLat) => {
      if (!dragging) return;
      dragging.coords[dragging.index] = point;
      (map.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData(lineFeature(dragging.coords));
      (map.getSource("vertices") as maplibregl.GeoJSONSource | undefined)?.setData(
        vertexCollection(dragging.coords, dragging.index, propsRef.current.showVertices && dragging.coords.length <= MAX_VISIBLE_VERTICES),
      );
    };
    const endDrag = (point: LonLat | null) => {
      if (!dragging) return;
      const { index } = dragging;
      dragging = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      if (point) propsRef.current.onMove(index, point);
    };

    map.on("mousedown", "vertices", (event) => {
      const { tool, editable } = propsRef.current;
      if (!editable || tool !== "move") return;
      const index = event.features?.[0]?.properties?.index;
      if (typeof index !== "number") return;
      event.preventDefault();
      startDrag(index);
    });
    map.on("touchstart", "vertices", (event) => {
      const { tool, editable } = propsRef.current;
      if (!editable || tool !== "move" || event.points.length !== 1) return;
      const index = event.features?.[0]?.properties?.index;
      if (typeof index !== "number") return;
      event.preventDefault();
      startDrag(index);
    });
    map.on("mousemove", (event) => {
      if (dragging) moveDrag(toPoint(event));
      else if (propsRef.current.editable) {
        const { tool } = propsRef.current;
        const overVertex = (tool === "move" || tool === "delete") && vertexAt(event.point) !== null;
        map.getCanvas().style.cursor = overVertex ? (tool === "move" ? "grab" : "pointer") : tool === "view" || !propsRef.current.editable ? "" : "crosshair";
      }
    });
    map.on("touchmove", (event) => {
      if (dragging) moveDrag(toPoint(event));
    });
    map.on("mouseup", (event) => endDrag(toPoint(event)));
    map.on("touchend", (event) => endDrag(toPoint(event)));

    return () => {
      window.clearTimeout(timer);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // ---- keep the layers in step with the editing state
  const { coords, pois, selected, showVertices } = props;
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData(lineFeature(coords));
    (map.getSource("vertices") as maplibregl.GeoJSONSource | undefined)?.setData(vertexCollection(coords, selected, showVertices && coords.length <= MAX_VISIBLE_VERTICES));
    (map.getSource("pois") as maplibregl.GeoJSONSource | undefined)?.setData(poiCollection(pois));
  }, [coords, pois, selected, showVertices, ready]);

  // ---- re-fit on request, or when the first points of a route drawn from scratch appear
  const { fitSignal } = props;
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fitSignal === 0) return;
    const bounds = boundsOf(propsRef.current.coords);
    if (bounds) map.fitBounds([bounds.west, bounds.south, bounds.east, bounds.north], { padding: 48, duration: 0, maxZoom: 17 });
  }, [fitSignal, ready]);

  const { focusSignal } = props;
  React.useEffect(() => {
    const map = mapRef.current;
    const { focusIndex, coords: current } = propsRef.current;
    if (!map || !ready || focusSignal === 0 || focusIndex === null || !current[focusIndex]) return;
    map.easeTo({ center: current[focusIndex] as LonLat, duration: 0, zoom: Math.max(map.getZoom(), 15) });
  }, [focusSignal, ready]);

  // maplibre-gl.css makes the container position:relative, so it fills an absolute wrapper instead.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
