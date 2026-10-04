"use client";

import React from "react";
import { ChevronLeft, ChevronRight, Crosshair, Flag, FlagTriangleRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/admin/panel";
import { InputField } from "@/components/admin/events/fields";
import { cumulativeM, formatCoordinate, formatKm, parseCoordinate, type LonLat } from "@/components/admin/routes/route-geometry";

const PAGE_SIZE = 25;

/**
 * The trace as a table plus a coordinate form: the keyboard and screen-reader equivalent of every map tool (select, move, insert, delete,
 * add, start, finish). Large imports have thousands of points, so the table pages by 25 and follows the selection. On narrow screens
 * the table is read-only (route editing is a tablet/desktop task, UX mobile-limited rule).
 */
export function VertexPanel({
  coords,
  selected,
  canEdit,
  onSelect,
  onMove,
  onInsertAfter,
  onDelete,
  onAdd,
  onSetEdge,
  onCenter,
}: {
  coords: readonly LonLat[];
  selected: number | null;
  canEdit: boolean;
  onSelect: (index: number) => void;
  onMove: (index: number, point: LonLat) => void;
  onInsertAfter: (index: number) => void;
  onDelete: (index: number) => void;
  onAdd: (point: LonLat) => void;
  onSetEdge: (kind: "START" | "FINISH", index: number) => void;
  onCenter: (index: number) => void;
}) {
  const [requestedPage, setRequestedPage] = React.useState(0);
  const [followed, setFollowed] = React.useState<number | null>(null);
  // The table follows the selection (a point picked on the map): adjust during render, the React-recommended alternative to an effect.
  if (selected !== followed) {
    setFollowed(selected);
    if (selected !== null) setRequestedPage(Math.floor(selected / PAGE_SIZE));
  }
  const pageCount = Math.max(1, Math.ceil(coords.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount - 1);
  const start = page * PAGE_SIZE;
  const rows = coords.slice(start, start + PAGE_SIZE);
  // Cumulative distances need the whole prefix; recomputed only when the trace changes.
  const cumulative = React.useMemo(() => cumulativeM(coords), [coords]);

  return (
    <Panel title="Puntos del trazo" description="Lista de puntos con sus coordenadas: úsala en lugar del mapa o junto con él.">
      <div className="flex flex-col gap-4" data-testid="vertex-panel">
        {canEdit ? (
          <>
            {selected !== null && coords[selected] ? (
              <SelectedVertex
                key={`${selected}:${coords[selected][0]}:${coords[selected][1]}`}
                index={selected}
                total={coords.length}
                point={coords[selected]}
                onMove={onMove}
                onInsertAfter={onInsertAfter}
                onDelete={onDelete}
                onSetEdge={onSetEdge}
                onCenter={onCenter}
              />
            ) : (
              <p className="text-body-sm text-ink-60" data-testid="vertex-none-selected">
                Selecciona un punto de la tabla (o en el mapa) para editar sus coordenadas, insertar uno después, eliminarlo o usarlo como salida o meta.
              </p>
            )}
            <AddByCoordinates onAdd={onAdd} />
          </>
        ) : null}

        {coords.length === 0 ? (
          <p className="text-body-sm text-ink-60" data-testid="vertex-empty">
            La ruta todavía no tiene puntos.{canEdit ? " Agrega el primero con el mapa o con el formulario de coordenadas." : ""}
          </p>
        ) : (
          <div>
            <div className="overflow-x-auto rounded-control border border-divider">
              <table className="w-full text-left text-body-sm" data-testid="vertex-table">
                <caption className="sr-only">
                  Puntos del trazo, del {start + 1} al {start + rows.length} de {coords.length}
                </caption>
                <thead className="bg-paper-sunken text-caption text-ink-60">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Punto
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Latitud
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Longitud
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Distancia acumulada
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((point, offset) => {
                    const index = start + offset;
                    const isSelected = index === selected;
                    return (
                      <tr key={index} aria-selected={isSelected || undefined} className={isSelected ? "bg-lime-soft" : "border-t border-divider"} data-vertex-index={index}>
                        <th scope="row" className="px-3 py-1 font-semibold">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-pressed={isSelected}
                            aria-label={`Seleccionar el punto ${index + 1}`}
                            onClick={() => onSelect(index)}
                          >
                            {index + 1}
                            {index === 0 ? <span className="text-caption font-normal text-ink-60">inicio</span> : index === coords.length - 1 ? <span className="text-caption font-normal text-ink-60">fin</span> : null}
                          </Button>
                        </th>
                        <td className="px-3 py-1 tabular-nums">{formatCoordinate(point[1])}</td>
                        <td className="px-3 py-1 tabular-nums">{formatCoordinate(point[0])}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{formatKm(cumulative[index], 3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pageCount > 1 ? (
              <nav aria-label="Páginas de puntos" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-body-sm text-ink-80">
                <span data-testid="vertex-range">
                  Puntos {start + 1}–{start + rows.length} de {coords.length.toLocaleString("es-MX")}
                </span>
                <span className="flex gap-1">
                  <Button type="button" size="sm" variant="secondary" disabled={page === 0} onClick={() => setRequestedPage(page - 1)}>
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    Anteriores
                  </Button>
                  <Button type="button" size="sm" variant="secondary" disabled={page >= pageCount - 1} onClick={() => setRequestedPage(page + 1)}>
                    Siguientes
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </span>
              </nav>
            ) : null}
          </div>
        )}
      </div>
    </Panel>
  );
}

function SelectedVertex({
  index,
  total,
  point,
  onMove,
  onInsertAfter,
  onDelete,
  onSetEdge,
  onCenter,
}: {
  index: number;
  total: number;
  point: LonLat;
  onMove: (index: number, point: LonLat) => void;
  onInsertAfter: (index: number) => void;
  onDelete: (index: number) => void;
  onSetEdge: (kind: "START" | "FINISH", index: number) => void;
  onCenter: (index: number) => void;
}) {
  const [lat, setLat] = React.useState(formatCoordinate(point[1]));
  const [lon, setLon] = React.useState(formatCoordinate(point[0]));
  const [errors, setErrors] = React.useState<{ lat?: string; lon?: string }>({});

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const nextLat = parseCoordinate(lat, "lat");
    const nextLon = parseCoordinate(lon, "lon");
    const next = {
      lat: nextLat === null ? "Latitud entre -90 y 90 (ej. 25.6866)." : undefined,
      lon: nextLon === null ? "Longitud entre -180 y 180 (ej. -100.3161)." : undefined,
    };
    setErrors(next);
    if (nextLat === null || nextLon === null) return;
    onMove(index, [nextLon, nextLat]);
  }

  return (
    <form onSubmit={apply} noValidate className="rounded-control border border-divider p-3" aria-label={`Punto seleccionado ${index + 1}`} data-testid="selected-vertex">
      <p className="mb-2 text-body-sm font-semibold text-ink">
        Punto {index + 1} de {total.toLocaleString("es-MX")}
      </p>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <InputField id="vertex-lat" name="lat" label="Latitud" inputMode="decimal" value={lat} error={errors.lat} autoComplete="off" onChange={(event) => setLat(event.target.value)} />
        <InputField id="vertex-lon" name="lon" label="Longitud" inputMode="decimal" value={lon} error={errors.lon} autoComplete="off" onChange={(event) => setLon(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          Aplicar coordenadas
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => onInsertAfter(index)} disabled={index >= total - 1} title="Inserta un punto a mitad de camino hacia el siguiente">
          <Plus className="size-4" aria-hidden="true" />
          Insertar después
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => onSetEdge("START", index)}>
          <Flag className="size-4" aria-hidden="true" />
          Usar como salida
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => onSetEdge("FINISH", index)}>
          <FlagTriangleRight className="size-4" aria-hidden="true" />
          Usar como meta
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onCenter(index)}>
          <Crosshair className="size-4" aria-hidden="true" />
          Centrar en el mapa
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDelete(index)}>
          <Trash2 className="size-4" aria-hidden="true" />
          Eliminar punto
        </Button>
      </div>
    </form>
  );
}

function AddByCoordinates({ onAdd }: { onAdd: (point: LonLat) => void }) {
  const [lat, setLat] = React.useState("");
  const [lon, setLon] = React.useState("");
  const [errors, setErrors] = React.useState<{ lat?: string; lon?: string }>({});

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextLat = parseCoordinate(lat, "lat");
    const nextLon = parseCoordinate(lon, "lon");
    setErrors({
      lat: nextLat === null ? "Latitud entre -90 y 90 (ej. 25.6866)." : undefined,
      lon: nextLon === null ? "Longitud entre -180 y 180 (ej. -100.3161)." : undefined,
    });
    if (nextLat === null || nextLon === null) return;
    onAdd([nextLon, nextLat]);
    setLat("");
    setLon("");
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-control border border-divider p-3" aria-label="Agregar un punto por coordenadas" data-testid="add-vertex-form">
      <p className="mb-2 text-body-sm font-semibold text-ink">Agregar un punto por coordenadas</p>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <InputField id="add-lat" name="add-lat" label="Latitud" inputMode="decimal" value={lat} error={errors.lat} autoComplete="off" onChange={(event) => setLat(event.target.value)} />
        <InputField id="add-lon" name="add-lon" label="Longitud" inputMode="decimal" value={lon} error={errors.lon} autoComplete="off" onChange={(event) => setLon(event.target.value)} />
      </div>
      <Button type="submit" size="sm" variant="secondary">
        <Plus className="size-4" aria-hidden="true" />
        Agregar al final de la ruta
      </Button>
    </form>
  );
}
