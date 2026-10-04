import type { JsonObject } from "@/lib/shared/api-contract";
import type { FieldErrors } from "@/components/admin/events/form-logic";

/**
 * Pure logic of the Edition locations screen (P3-E2, Master §43). Edge validation only: the database re-validates and names the
 * field it refuses. The API cannot clear an optional value once saved (its PATCH schema has no null), so an edit that empties
 * one is refused here with the way out, instead of being sent and silently ignored.
 */

export type LocationType = "DISCOVERY" | "VENUE" | "START" | "FINISH" | "MEETING_POINT" | "PARKING" | "KIT_PICKUP" | "OTHER";

export const LOCATION_TYPE_OPTIONS: readonly { value: LocationType; label: string }[] = [
  { value: "VENUE", label: "Sede del evento" },
  { value: "START", label: "Salida" },
  { value: "FINISH", label: "Meta" },
  { value: "MEETING_POINT", label: "Punto de reunión" },
  { value: "KIT_PICKUP", label: "Entrega de kits" },
  { value: "PARKING", label: "Estacionamiento" },
  { value: "DISCOVERY", label: "Punto de descubrimiento" },
  { value: "OTHER", label: "Otro" },
];

export const LOCATION_TYPE_LABEL: Record<string, string> = Object.fromEntries(LOCATION_TYPE_OPTIONS.map((option) => [option.value, option.label]));

export type LocationRow = {
  edition_location_id: string;
  location_type: LocationType;
  name: string;
  address_line: string | null;
  city: string | null;
  state_region: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  is_primary: boolean;
  sort_order: number;
};

export type LocationValues = {
  location_type: LocationType;
  name: string;
  address_line: string;
  city: string;
  state_region: string;
  country_code: string;
  latitude: string;
  longitude: string;
  is_primary: boolean;
  sort_order: string;
};

export function emptyLocationValues(): LocationValues {
  return {
    location_type: "VENUE",
    name: "",
    address_line: "",
    city: "",
    state_region: "",
    country_code: "",
    latitude: "",
    longitude: "",
    is_primary: false,
    sort_order: "",
  };
}

export function locationToValues(row: LocationRow): LocationValues {
  return {
    location_type: row.location_type,
    name: row.name,
    address_line: row.address_line ?? "",
    city: row.city ?? "",
    state_region: row.state_region ?? "",
    country_code: row.country_code ?? "",
    latitude: row.latitude === null ? "" : String(row.latitude),
    longitude: row.longitude === null ? "" : String(row.longitude),
    is_primary: row.is_primary,
    sort_order: String(row.sort_order),
  };
}

const COORDINATE = /^-?\d+(\.\d+)?$/;
export const CANNOT_CLEAR = "Un dato guardado no se puede dejar vacío desde aquí. Cámbialo por otro valor, o elimina el registro y créalo de nuevo.";

export function validateLocation(values: LocationValues, initial?: LocationValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = "Este campo es obligatorio.";
  else if (values.name.trim().length > 160) errors.name = "Máximo 160 caracteres.";
  if (values.address_line.length > 300) errors.address_line = "Máximo 300 caracteres.";
  if (values.country_code.trim() !== "" && !/^[A-Za-z]{2}$/.test(values.country_code.trim())) errors.country_code = "Código de país de 2 letras (ej. MX).";

  const lat = values.latitude.trim();
  const lng = values.longitude.trim();
  if (lat !== "" && (!COORDINATE.test(lat) || Math.abs(Number(lat)) > 90)) errors.latitude = "Número entre -90 y 90.";
  if (lng !== "" && (!COORDINATE.test(lng) || Math.abs(Number(lng)) > 180)) errors.longitude = "Número entre -180 y 180.";
  if (!errors.latitude && !errors.longitude && (lat === "") !== (lng === "")) {
    errors[lat === "" ? "latitude" : "longitude"] = "Indica latitud y longitud juntas, o ninguna de las dos.";
  }
  if (values.sort_order.trim() !== "" && !/^\d{1,5}$/.test(values.sort_order.trim())) errors.sort_order = "Número entero, 0 o mayor.";

  if (initial) {
    for (const field of ["address_line", "city", "state_region", "country_code", "latitude", "longitude"] as const) {
      if (initial[field].trim() !== "" && values[field].trim() === "" && !errors[field]) errors[field] = CANNOT_CLEAR;
    }
  }
  return errors;
}

/** Body for POST /editions/:id/locations: only what was filled in. */
export function buildLocationBody(values: LocationValues): JsonObject {
  const body: JsonObject = { location_type: values.location_type, name: values.name.trim() };
  if (values.address_line.trim()) body.address_line = values.address_line.trim();
  if (values.city.trim()) body.city = values.city.trim();
  if (values.state_region.trim()) body.state_region = values.state_region.trim();
  if (values.country_code.trim()) body.country_code = values.country_code.trim().toUpperCase();
  if (values.latitude.trim() && values.longitude.trim()) {
    body.latitude = Number(values.latitude);
    body.longitude = Number(values.longitude);
  }
  if (values.is_primary) body.is_primary = true;
  if (values.sort_order.trim()) body.sort_order = Number(values.sort_order);
  return body;
}

/** Body for PATCH /locations/:id: only the fields that changed; null when nothing did. */
export function buildLocationPatch(initial: LocationValues, values: LocationValues): JsonObject | null {
  const patch: JsonObject = {};
  const create = buildLocationBody(values);
  if (values.location_type !== initial.location_type) patch.location_type = values.location_type;
  if (values.name.trim() !== initial.name) patch.name = values.name.trim();
  for (const field of ["address_line", "city", "state_region"] as const) {
    if (values[field].trim() !== initial[field].trim() && values[field].trim()) patch[field] = values[field].trim();
  }
  if (values.country_code.trim().toUpperCase() !== initial.country_code.trim().toUpperCase() && values.country_code.trim()) {
    patch.country_code = values.country_code.trim().toUpperCase();
  }
  if ((values.latitude.trim() !== initial.latitude.trim() || values.longitude.trim() !== initial.longitude.trim()) && create.latitude !== undefined) {
    patch.latitude = create.latitude;
    patch.longitude = create.longitude;
  }
  if (values.is_primary !== initial.is_primary) patch.is_primary = values.is_primary;
  if (values.sort_order.trim() !== initial.sort_order.trim() && values.sort_order.trim()) patch.sort_order = Number(values.sort_order);
  return Object.keys(patch).length > 0 ? patch : null;
}

export function formatCoordinates(row: Pick<LocationRow, "latitude" | "longitude">): string | null {
  if (row.latitude === null || row.longitude === null) return null;
  return `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`;
}

export function mapsHref(row: Pick<LocationRow, "latitude" | "longitude">): string | null {
  if (row.latitude === null || row.longitude === null) return null;
  return `https://www.openstreetmap.org/?mlat=${row.latitude}&mlon=${row.longitude}#map=17/${row.latitude}/${row.longitude}`;
}
