"use client";

import React from "react";
import { CircleAlert, Eye, Flag, FlagTriangleRight, Maximize, MapPin, Move, PenLine, Plus, Redo2, Ruler, Trash2, TriangleAlert, Undo2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/cn";
import type { MapTool } from "@/components/admin/routes/route-editor-canvas";
import { EXTRA_POI_TYPES, POI_TYPE_LABEL, formatKm, type PoiType } from "@/components/admin/routes/route-geometry";

/** What each map tool does, in the operator's words. Also the source of the hint under the toolbar (the map is not the only way to do any of it). */
export const TOOL_HELP: Record<MapTool, string> = {
  view: "Sin herramienta: haz clic en un punto de la ruta para seleccionarlo.",
  add: "Agregar punto: haz clic en el mapa para añadir un punto al final de la ruta.",
  insert: "Insertar punto: haz clic cerca de un tramo para añadir un punto en medio de él.",
  move: "Mover punto: arrastra un punto de la ruta a su nueva posición.",
  delete: "Eliminar punto: haz clic en un punto de la ruta para quitarlo.",
  start: "Configurar salida: haz clic en el mapa donde está la salida. Si ya había una, se mueve.",
  finish: "Configurar meta: haz clic en el mapa donde está la meta. Si ya había una, se mueve.",
  poi: "Puntos de interés: elige el tipo y haz clic en el mapa para colocarlo; después le pones nombre abajo.",
};

type ToolSpec = { tool: MapTool; label: string; icon: LucideIcon };

const GROUPS: { label: string; tools: ToolSpec[] }[] = [
  {
    label: "Trazo",
    tools: [
      { tool: "add", label: "Agregar punto", icon: Plus },
      { tool: "move", label: "Mover punto", icon: Move },
      { tool: "insert", label: "Insertar punto", icon: PenLine },
      { tool: "delete", label: "Eliminar punto", icon: Trash2 },
    ],
  },
  {
    label: "Salida y meta",
    tools: [
      { tool: "start", label: "Configurar salida", icon: Flag },
      { tool: "finish", label: "Configurar meta", icon: FlagTriangleRight },
    ],
  },
];

/**
 * RouteEditorToolbar (ui-spec §3.10 / UX J13 step 7): add, move, insert and delete vertex, undo, redo, configure start and finish, POIs,
 * calculate distance, warnings, errors and preview, grouped by function. Each tool is a labelled toggle (state in `aria-pressed`, never
 * colour alone). `computed` is the live distance of what is on screen; the persisted distance and the official one are separate readouts
 * in the summary, and neither is ever overwritten by this one.
 */
export function RouteToolbar({
  tool,
  onTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFit,
  onCalculate,
  computedM,
  poiType,
  onPoiType,
  preview,
  onPreview,
  errorCount,
  warningCount,
  validated,
}: {
  tool: MapTool;
  onTool: (tool: MapTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onCalculate: () => void;
  computedM: number;
  poiType: PoiType;
  onPoiType: (type: PoiType) => void;
  preview: boolean;
  onPreview: () => void;
  errorCount: number;
  warningCount: number;
  validated: boolean;
}) {
  const toggle = (spec: ToolSpec) => (
    <Button
      key={spec.tool}
      type="button"
      size="sm"
      variant={tool === spec.tool ? "primary" : "secondary"}
      aria-pressed={tool === spec.tool}
      title={TOOL_HELP[spec.tool]}
      disabled={preview}
      onClick={() => onTool(tool === spec.tool ? "view" : spec.tool)}
    >
      <spec.icon className="size-4" aria-hidden="true" />
      {spec.label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-2" data-testid="route-toolbar">
      <div role="toolbar" aria-label="Herramientas de la ruta" className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {GROUPS.map((group, index) => (
          <React.Fragment key={group.label}>
            {index > 0 ? <Divider /> : null}
            <div role="group" aria-label={group.label} className="flex flex-wrap gap-1">
              {group.tools.map(toggle)}
            </div>
          </React.Fragment>
        ))}
        <Divider />
        <div role="group" aria-label="Puntos de interés" className="flex flex-wrap items-center gap-1">
          {toggle({ tool: "poi", label: "Puntos de interés", icon: MapPin })}
          <label className="sr-only" htmlFor="route-poi-type">
            Tipo de punto de interés a colocar
          </label>
          <select
            id="route-poi-type"
            value={poiType}
            disabled={preview}
            onChange={(event) => onPoiType(event.target.value as PoiType)}
            className="h-9 rounded-control border border-control bg-paper-raised px-2 text-body-sm text-ink disabled:cursor-not-allowed disabled:bg-paper-sunken disabled:text-ink-35"
          >
            {EXTRA_POI_TYPES.map((type) => (
              <option key={type} value={type}>
                {POI_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
        <Divider />
        <div role="group" aria-label="Historial" className="flex gap-1">
          <Button type="button" size="sm" variant="secondary" disabled={!canUndo} onClick={onUndo} aria-keyshortcuts="Control+Z" title="Deshacer (Ctrl+Z)">
            <Undo2 className="size-4" aria-hidden="true" />
            Deshacer
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={!canRedo} onClick={onRedo} aria-keyshortcuts="Control+Y" title="Rehacer (Ctrl+Y)">
            <Redo2 className="size-4" aria-hidden="true" />
            Rehacer
          </Button>
        </div>
      </div>

      <div role="group" aria-label="Distancia, avisos y vista previa" className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Button type="button" size="sm" variant="secondary" onClick={onCalculate} title="Calcular la distancia de la ruta tal como está en pantalla">
          <Ruler className="size-4" aria-hidden="true" />
          Calcular distancia
        </Button>
        <p className="text-body-sm text-ink" data-testid="computed-distance">
          <span className="text-ink-60">En pantalla: </span>
          <span className="font-display text-body font-bold tabular-nums">{formatKm(computedM)}</span>
        </p>
        <Divider />
        <a
          href="#route-validation"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-control border px-3 text-body-sm font-semibold",
            warningCount > 0 ? "border-warning-border bg-warning-tint text-warning" : "border-control bg-paper-raised text-ink",
          )}
        >
          <TriangleAlert className="size-4" aria-hidden="true" />
          Advertencias: {validated ? warningCount : "sin validar"}
        </a>
        <a
          href="#route-validation"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-control border px-3 text-body-sm font-semibold",
            errorCount > 0 ? "border-danger-border bg-danger-tint text-danger" : "border-control bg-paper-raised text-ink",
          )}
        >
          <CircleAlert className="size-4" aria-hidden="true" />
          Errores: {validated ? errorCount : "sin validar"}
        </a>
        <Divider />
        <Button type="button" size="sm" variant={preview ? "primary" : "secondary"} aria-pressed={preview} onClick={onPreview} title="Ver la ruta sin puntos de edición, como la verá el público">
          <Eye className="size-4" aria-hidden="true" />
          Vista previa
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onFit} title="Ajustar el mapa para ver toda la ruta">
          <Maximize className="size-4" aria-hidden="true" />
          Ajustar vista
        </Button>
      </div>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="hidden h-6 w-px bg-divider sm:inline-block" />;
}
