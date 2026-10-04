"use client";

import React from "react";
import { ExternalLink, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { DeleteDialog } from "@/components/admin/edition-config/delete-dialog";
import { Panel } from "@/components/admin/panel";
import { CheckField, InputField, SelectField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import type { FieldErrors } from "@/components/admin/events/form-logic";
import { AdminBadge } from "@/components/admin/status-badges";
import {
  LOCATION_TYPE_LABEL,
  LOCATION_TYPE_OPTIONS,
  buildLocationBody,
  buildLocationPatch,
  emptyLocationValues,
  formatCoordinates,
  locationToValues,
  mapsHref,
  validateLocation,
  type LocationRow,
  type LocationType,
  type LocationValues,
} from "@/components/admin/edition-config/location-logic";

/** Where things happen (Master §43): venue, start, finish, kit pickup, parking. One may be the primary place shown on the public page. */
export function LocationsManager({
  editionId,
  locations,
  defaults,
}: {
  editionId: string;
  locations: readonly LocationRow[];
  /** City / state / country of the Edition, offered as the starting values of a new location. */
  defaults: { city: string; state_region: string; country_code: string };
}) {
  const [editing, setEditing] = React.useState<LocationRow | "new" | null>(null);
  const [removing, setRemoving] = React.useState<LocationRow | null>(null);

  return (
    <Panel
      title="Ubicaciones de la edición"
      description="Lugares que verá el público y que usa el equipo en la operación. La principal es la que identifica a la edición en su página."
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" />
          Agregar ubicación
        </Button>
      }
    >
      {locations.length === 0 ? (
        <p className="text-body-sm text-ink-60" data-testid="locations-empty">
          Sin ubicaciones todavía. Agrega al menos la sede o el punto de salida.
        </p>
      ) : (
        <ul className="divide-y divide-divider">
          {locations.map((location) => {
            const coordinates = formatCoordinates(location);
            const map = mapsHref(location);
            const place = [location.address_line, location.city, location.state_region, location.country_code].filter(Boolean).join(", ");
            return (
              <li key={location.edition_location_id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0" data-location-name={location.name}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-ink">
                    <MapPin className="size-4 shrink-0 text-ink-60" aria-hidden="true" />
                    {location.name}
                    <span className="text-caption font-normal text-ink-60">{LOCATION_TYPE_LABEL[location.location_type] ?? location.location_type}</span>
                    {location.is_primary ? (
                      <AdminBadge icon={Star} tone="info">
                        Principal
                      </AdminBadge>
                    ) : null}
                  </p>
                  <p className="text-caption text-ink-60">{place || "Sin dirección"}</p>
                  {coordinates ? (
                    <p className="text-caption text-ink-60">
                      Coordenadas {coordinates}
                      {map ? (
                        <>
                          {" · "}
                          <a href={map} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                            Ver en el mapa
                            <ExternalLink className="size-3" aria-hidden="true" />
                            <span className="sr-only"> (se abre en una pestaña nueva)</span>
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(location)}>
                    <Pencil className="size-4" aria-hidden="true" />
                    Editar<span className="sr-only"> la ubicación {location.name}</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(location)}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    Eliminar<span className="sr-only"> la ubicación {location.name}</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <LocationDialog
          key={editing === "new" ? "new" : editing.edition_location_id}
          editionId={editionId}
          location={editing === "new" ? null : editing}
          defaults={defaults}
          firstLocation={locations.length === 0}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {removing ? (
        <DeleteDialog
          title={`Eliminar «${removing.name}»`}
          description="La ubicación deja de mostrarse. Si una entrada de la agenda la usa, el servidor no la elimina: primero cambia esa entrada."
          endpoint={`/api/v1/admin/locations/${removing.edition_location_id}`}
          confirmLabel="Eliminar ubicación"
          successMessage="Ubicación eliminada"
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Panel>
  );
}

function LocationDialog({
  editionId,
  location,
  defaults,
  firstLocation,
  onClose,
}: {
  editionId: string;
  location: LocationRow | null;
  defaults: { city: string; state_region: string; country_code: string };
  firstLocation: boolean;
  onClose: () => void;
}) {
  const editing = location !== null;
  const initial = React.useMemo<LocationValues>(
    () =>
      location
        ? locationToValues(location)
        : { ...emptyLocationValues(), city: defaults.city, state_region: defaults.state_region, country_code: defaults.country_code, is_primary: firstLocation },
    [location, defaults, firstLocation],
  );
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const set = <K extends keyof LocationValues>(key: K, value: LocationValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const next = validateLocation(values, location ? initial : undefined);
    setErrors(next);
    if (Object.values(next).some(Boolean)) return null;
    if (location) {
      const patch = buildLocationPatch(initial, values);
      if (!patch) {
        setErrors({ name: "No hay cambios que guardar." });
        return null;
      }
      return apiFetch(`/api/v1/admin/locations/${location.edition_location_id}`, { method: "PATCH", body: patch });
    }
    return apiFetch(`/api/v1/admin/editions/${editionId}/locations`, { method: "POST", body: buildLocationBody(values) });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={editing ? `Editar ${location.name}` : "Agregar ubicación"}
      description="Las coordenadas son opcionales; si las indicas, deben ir las dos."
      submitLabel={editing ? "Guardar ubicación" : "Agregar ubicación"}
      successMessage={editing ? "Ubicación actualizada" : "Ubicación agregada"}
      onSubmit={onSubmit}
      widthClassName="max-w-2xl"
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField
          id="location-type"
          name="location_type"
          label="Tipo"
          required
          value={values.location_type}
          options={LOCATION_TYPE_OPTIONS}
          onChange={(event) => set("location_type", event.target.value as LocationType)}
        />
        <InputField id="location-name" name="name" label="Nombre del lugar" required value={values.name} error={errors.name} maxLength={160} autoComplete="off" onChange={(event) => set("name", event.target.value)} />
        <InputField
          id="location-address"
          name="address_line"
          label="Dirección"
          value={values.address_line}
          error={errors.address_line}
          maxLength={300}
          autoComplete="off"
          className="sm:col-span-2"
          onChange={(event) => set("address_line", event.target.value)}
        />
        <InputField id="location-city" name="city" label="Ciudad" value={values.city} error={errors.city} autoComplete="off" onChange={(event) => set("city", event.target.value)} />
        <InputField id="location-state" name="state_region" label="Estado" value={values.state_region} error={errors.state_region} autoComplete="off" onChange={(event) => set("state_region", event.target.value)} />
        <InputField
          id="location-country"
          name="country_code"
          label="País (2 letras)"
          value={values.country_code}
          error={errors.country_code}
          maxLength={2}
          autoComplete="off"
          onChange={(event) => set("country_code", event.target.value.toUpperCase())}
        />
        <InputField id="location-order" name="sort_order" label="Orden" inputMode="numeric" value={values.sort_order} error={errors.sort_order} autoComplete="off" onChange={(event) => set("sort_order", event.target.value)} />
        <InputField id="location-lat" name="latitude" label="Latitud" inputMode="decimal" value={values.latitude} error={errors.latitude} helperText="Ej. 25.6866" autoComplete="off" onChange={(event) => set("latitude", event.target.value)} />
        <InputField id="location-lng" name="longitude" label="Longitud" inputMode="decimal" value={values.longitude} error={errors.longitude} helperText="Ej. -100.3161" autoComplete="off" onChange={(event) => set("longitude", event.target.value)} />
      </div>
      <CheckField
        id="location-primary"
        label="Ubicación principal"
        helperText="Solo una es principal: al marcar esta, deja de serlo la anterior."
        checked={values.is_primary}
        onChange={(checked) => set("is_primary", checked)}
      />
    </FormDialog>
  );
}
