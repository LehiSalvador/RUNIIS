import React from "react";
import { DefinitionList, Panel } from "@/components/admin/panel";
import {
  POI_TYPE_LABEL,
  formatCoordinate,
  formatKm,
  type LonLat,
  type ModalityOption,
  type PoiDraft,
} from "@/components/admin/routes/route-geometry";

function placeOf(poi: PoiDraft | undefined) {
  return poi ? `${poi.name || POI_TYPE_LABEL[poi.poi_type]} (${formatCoordinate(poi.latitude)}, ${formatCoordinate(poi.longitude)})` : "Sin definir";
}

/**
 * The route in words (the non-map alternative of ui-spec §3.10, OQ-5): three DIFFERENT distances, never merged (computed on screen,
 * stored by the server, official of each modality), start and finish, counts and the elevation note. Always rendered next to the map, so
 * the information is available whether or not the canvas runs.
 */
export function RouteSummary({
  coords,
  pois,
  computedM,
  serverDistanceM,
  modalities,
  saved,
}: {
  coords: readonly LonLat[];
  pois: readonly PoiDraft[];
  computedM: number;
  serverDistanceM: number | null;
  modalities: readonly ModalityOption[];
  /** False for a revision not saved yet (drawn from scratch). */
  saved: boolean;
}) {
  const start = pois.find((poi) => poi.poi_type === "START");
  const finish = pois.find((poi) => poi.poi_type === "FINISH");
  const extras = pois.filter((poi) => poi.poi_type !== "START" && poi.poi_type !== "FINISH").length;
  return (
    <Panel title="Resumen de la ruta" description="Lo mismo que muestra el mapa, en texto.">
      <div data-testid="route-summary">
        <DefinitionList
          columns={2}
          items={[
            { label: "Distancia calculada en pantalla", value: <span data-testid="summary-computed">{formatKm(computedM)}</span> },
            {
              label: "Distancia calculada por el servidor",
              value: <span data-testid="summary-server">{saved ? formatKm(serverDistanceM) : "Aún no se guarda"}</span>,
            },
            { label: "Puntos del trazo", value: <span data-testid="summary-vertices">{coords.length.toLocaleString("es-MX")}</span> },
            { label: "Puntos de interés", value: `${extras.toLocaleString("es-MX")} además de salida y meta` },
            { label: "Salida", value: placeOf(start) },
            { label: "Meta", value: placeOf(finish) },
            { label: "Elevación", value: "No disponible: la ruta guarda solo latitud y longitud, no altitud." },
            {
              label: "Distancia oficial",
              value:
                modalities.length === 0 ? (
                  "La ruta no tiene modalidades."
                ) : (
                  <ul className="space-y-0.5">
                    {modalities.map((modality) => (
                      <li key={modality.modality_id}>
                        {modality.name}: {modality.official_distance_m ? formatKm(modality.official_distance_m, 1) : "sin distancia oficial"}
                      </li>
                    ))}
                  </ul>
                ),
            },
          ]}
        />
        <p className="mt-3 text-caption text-ink-60">
          La distancia oficial es un dato de la modalidad que se fija en «Modalidades y precios»: calcular o importar una ruta nunca la cambia.
        </p>
      </div>
    </Panel>
  );
}
