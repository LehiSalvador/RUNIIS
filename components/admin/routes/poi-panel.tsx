"use client";

import React from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/admin/panel";
import { InputField, SelectField, TextareaField } from "@/components/admin/events/fields";
import {
  EXTRA_POI_TYPES,
  POI_TYPES,
  POI_TYPE_LABEL,
  formatCoordinate,
  isPoiType,
  parseCoordinate,
  type PoiDraft,
  type PoiType,
} from "@/components/admin/routes/route-geometry";

/**
 * Salida, meta and points of interest as an editable list (the non-map way to do everything the POI and start/finish tools do). In a
 * read-only revision (published, superseded, narrow screen) it is a plain list. Text fields commit when the field is left, so one
 * edit is one undo step and not one per keystroke.
 */
export function PoiPanel({
  pois,
  editable,
  problems,
  canAdd,
  onUpdate,
  onRemove,
  onAdd,
}: {
  pois: readonly PoiDraft[];
  editable: boolean;
  problems: Readonly<Record<string, string>>;
  /** A POI added from this panel starts on the selected (or first) point of the trace; with no trace there is nowhere to put it. */
  canAdd: boolean;
  onUpdate: (key: string, patch: Partial<Omit<PoiDraft, "key">>) => void;
  onRemove: (key: string) => void;
  onAdd: (type: PoiType) => void;
}) {
  const [newType, setNewType] = React.useState<PoiType>("HYDRATION");
  return (
    <Panel
      title="Salida, meta y puntos de interés"
      description={editable ? "Cada punto lleva tipo, nombre y posición. La salida y la meta son únicas." : "Puntos guardados en esta revisión."}
    >
      <div className="flex flex-col gap-3" data-testid="poi-panel">
        {pois.length === 0 ? (
          <p className="text-body-sm text-ink-60" data-testid="poi-empty">
            Esta revisión no tiene salida, meta ni puntos de interés.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pois.map((poi) =>
              editable ? (
                <PoiEditor key={poi.key} poi={poi} error={problems[poi.key]} onUpdate={onUpdate} onRemove={onRemove} />
              ) : (
                <li key={poi.key} className="rounded-control border border-divider p-3 text-body-sm" data-poi-type={poi.poi_type}>
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    <MapPin className="size-4 text-ink-60" aria-hidden="true" />
                    {poi.name}
                    <span className="text-caption font-normal text-ink-60">{POI_TYPE_LABEL[poi.poi_type]}</span>
                  </p>
                  {poi.description ? <p className="text-ink-80">{poi.description}</p> : null}
                  <p className="text-caption text-ink-60">
                    {formatCoordinate(poi.latitude)}, {formatCoordinate(poi.longitude)}
                  </p>
                </li>
              ),
            )}
          </ul>
        )}

        {editable ? (
          <div className="flex flex-wrap items-end gap-2 rounded-control border border-divider p-3">
            <div className="min-w-48 flex-1">
              <SelectField
                id="new-poi-type"
                name="new-poi-type"
                label="Agregar un punto de interés"
                value={newType}
                options={EXTRA_POI_TYPES.map((type) => ({ value: type, label: POI_TYPE_LABEL[type] }))}
                onChange={(event) => setNewType(event.target.value as PoiType)}
                helperText={canAdd ? "Se coloca en el punto seleccionado de la ruta (o en el primero); corrige su posición después." : "Primero traza la ruta."}
              />
            </div>
            <Button type="button" variant="secondary" disabled={!canAdd} onClick={() => onAdd(newType)} className="mb-1 self-end">
              <Plus className="size-4" aria-hidden="true" />
              Agregar punto
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

type Draft = { name: string; description: string; lat: string; lon: string };

function toDraft(poi: PoiDraft): Draft {
  return { name: poi.name, description: poi.description, lat: formatCoordinate(poi.latitude), lon: formatCoordinate(poi.longitude) };
}

function PoiEditor({
  poi,
  error,
  onUpdate,
  onRemove,
}: {
  poi: PoiDraft;
  error: string | undefined;
  onUpdate: (key: string, patch: Partial<Omit<PoiDraft, "key">>) => void;
  onRemove: (key: string) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(poi));
  const [seen, setSeen] = React.useState(poi);
  const [coordError, setCoordError] = React.useState<{ lat?: string; lon?: string }>({});
  // The POI changed from outside (undo, redo, a save answer): show it. Adjusting state while rendering is the supported alternative to an effect.
  if (seen !== poi) {
    setSeen(poi);
    setDraft(toDraft(poi));
  }
  const id = `poi-${poi.key}`;
  const label = `${POI_TYPE_LABEL[poi.poi_type]}${poi.name ? ` «${poi.name}»` : ""}`;

  const commitText = (field: "name" | "description") => {
    if (draft[field] !== poi[field]) onUpdate(poi.key, { [field]: draft[field] });
  };
  const commitCoordinate = (field: "lat" | "lon") => {
    const parsed = parseCoordinate(draft[field], field);
    if (parsed === null) {
      setCoordError((current) => ({ ...current, [field]: field === "lat" ? "Latitud entre -90 y 90." : "Longitud entre -180 y 180." }));
      return;
    }
    setCoordError((current) => ({ ...current, [field]: undefined }));
    const key = field === "lat" ? "latitude" : "longitude";
    if (parsed !== poi[key]) onUpdate(poi.key, { [key]: parsed });
  };

  return (
    <li className="rounded-control border border-divider p-3" data-poi-type={poi.poi_type} data-testid="poi-editor" aria-label={label}>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <SelectField
          id={`${id}-type`}
          name="poi_type"
          label="Tipo"
          value={poi.poi_type}
          options={POI_TYPES.map((type) => ({ value: type, label: POI_TYPE_LABEL[type] }))}
          onChange={(event) => (isPoiType(event.target.value) ? onUpdate(poi.key, { poi_type: event.target.value }) : undefined)}
        />
        <InputField
          id={`${id}-name`}
          name="name"
          label="Nombre"
          required
          value={draft.name}
          error={error}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          onBlur={() => commitText("name")}
        />
        <InputField
          id={`${id}-lat`}
          name="lat"
          label="Latitud"
          inputMode="decimal"
          value={draft.lat}
          error={coordError.lat}
          autoComplete="off"
          onChange={(event) => setDraft((current) => ({ ...current, lat: event.target.value }))}
          onBlur={() => commitCoordinate("lat")}
        />
        <InputField
          id={`${id}-lon`}
          name="lon"
          label="Longitud"
          inputMode="decimal"
          value={draft.lon}
          error={coordError.lon}
          autoComplete="off"
          onChange={(event) => setDraft((current) => ({ ...current, lon: event.target.value }))}
          onBlur={() => commitCoordinate("lon")}
        />
      </div>
      <TextareaField
        id={`${id}-description`}
        name="description"
        label="Descripción (opcional)"
        value={draft.description}
        maxLength={500}
        onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
        onBlur={() => commitText("description")}
      />
      <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(poi.key)}>
        <Trash2 className="size-4" aria-hidden="true" />
        Quitar<span className="sr-only"> {label}</span>
      </Button>
    </li>
  );
}
