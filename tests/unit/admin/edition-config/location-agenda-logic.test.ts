import { describe, expect, test } from "vitest";
import {
  agendaTimeRange,
  agendaToValues,
  buildAgendaBody,
  buildAgendaPatch,
  emptyAgendaValues,
  groupAgendaByDate,
  validateAgenda,
  type AgendaRow,
} from "@/components/admin/edition-config/agenda-logic";
import {
  CANNOT_CLEAR,
  buildLocationBody,
  buildLocationPatch,
  emptyLocationValues,
  formatCoordinates,
  locationToValues,
  mapsHref,
  validateLocation,
  type LocationRow,
} from "@/components/admin/edition-config/location-logic";

const location: LocationRow = {
  edition_location_id: "l1",
  location_type: "START",
  name: "Parque Fundidora",
  address_line: "Av. Fundidora 501",
  city: "Monterrey",
  state_region: "Nuevo León",
  country_code: "MX",
  latitude: 25.6781,
  longitude: -100.2844,
  is_primary: true,
  sort_order: 1,
};

describe("locations", () => {
  test("a new location needs a name; coordinates go in pairs inside the valid range", () => {
    expect(validateLocation(emptyLocationValues()).name).toBeDefined();
    expect(validateLocation({ ...emptyLocationValues(), name: "Sede" })).toEqual({});
    expect(validateLocation({ ...emptyLocationValues(), name: "Sede", latitude: "25.6" }).longitude).toContain("juntas");
    expect(validateLocation({ ...emptyLocationValues(), name: "Sede", latitude: "95", longitude: "10" }).latitude).toContain("-90 y 90");
    expect(validateLocation({ ...emptyLocationValues(), name: "Sede", latitude: "25", longitude: "-181" }).longitude).toContain("-180 y 180");
    expect(validateLocation({ ...emptyLocationValues(), name: "Sede", country_code: "MEX" }).country_code).toBeDefined();
  });

  test("the create body carries only what was filled, with numeric coordinates and an upper-case country", () => {
    const body = buildLocationBody({ ...emptyLocationValues(), name: " Meta ", location_type: "FINISH", city: "Monterrey", country_code: "mx", latitude: "25.6", longitude: "-100.3", is_primary: true });
    expect(body).toEqual({ location_type: "FINISH", name: "Meta", city: "Monterrey", country_code: "MX", latitude: 25.6, longitude: -100.3, is_primary: true });
    expect(buildLocationBody({ ...emptyLocationValues(), name: "X" })).toEqual({ location_type: "VENUE", name: "X" });
  });

  test("an edit sends only what changed, and nothing when nothing did", () => {
    const initial = locationToValues(location);
    expect(buildLocationPatch(initial, initial)).toBeNull();
    expect(buildLocationPatch(initial, { ...initial, name: "Fundidora" })).toEqual({ name: "Fundidora" });
    expect(buildLocationPatch(initial, { ...initial, is_primary: false })).toEqual({ is_primary: false });
    expect(buildLocationPatch(initial, { ...initial, latitude: "25.7", longitude: "-100.3" })).toEqual({ latitude: 25.7, longitude: -100.3 });
    expect(buildLocationPatch(initial, { ...initial, sort_order: "3", location_type: "FINISH" })).toEqual({ sort_order: 3, location_type: "FINISH" });
  });

  test("a saved optional value cannot be emptied (the API has no way to clear it), and the way out is said", () => {
    const initial = locationToValues(location);
    const errors = validateLocation({ ...initial, address_line: "", latitude: "", longitude: "" }, initial);
    expect(errors.address_line).toBe(CANNOT_CLEAR);
    expect(errors.latitude).toBeDefined();
    expect(validateLocation(initial, initial)).toEqual({});
    // a location that never had an address may stay without one
    const bare = locationToValues({ ...location, address_line: null });
    expect(validateLocation(bare, bare)).toEqual({});
  });

  test("coordinates are shown and linked only when both exist", () => {
    expect(formatCoordinates(location)).toBe("25.67810, -100.28440");
    expect(formatCoordinates({ latitude: null, longitude: 1 })).toBeNull();
    expect(mapsHref(location)).toContain("openstreetmap.org");
    expect(mapsHref({ latitude: null, longitude: null })).toBeNull();
  });
});

const item = (patch: Partial<AgendaRow>): AgendaRow => ({
  edition_schedule_item_id: "a1",
  modality_id: null,
  title: "Salida 10K",
  description: null,
  local_date: "2026-11-15",
  local_start_time: "07:00:00",
  local_end_time: null,
  location_id: null,
  sort_order: 1,
  status: "ACTIVE",
  ...patch,
});

describe("agenda", () => {
  test("title and day are required; the end follows the start", () => {
    expect(validateAgenda(emptyAgendaValues()).title).toBeDefined();
    expect(validateAgenda(emptyAgendaValues()).local_date).toBeDefined();
    const ok = { ...emptyAgendaValues("2026-11-15"), title: "Entrega de kits" };
    expect(validateAgenda(ok)).toEqual({});
    expect(validateAgenda({ ...ok, local_end_time: "10:00" }).local_end_time).toContain("hora de inicio");
    expect(validateAgenda({ ...ok, local_start_time: "10:00", local_end_time: "09:00" }).local_end_time).toContain("posterior");
    expect(validateAgenda({ ...ok, local_start_time: "10:00", local_end_time: "11:00" })).toEqual({});
  });

  test("create sends what was filled; an edit sends only the difference", () => {
    const values = { ...emptyAgendaValues("2026-11-14"), title: " Kits ", local_start_time: "09:00", location_id: "l1" };
    expect(buildAgendaBody(values)).toEqual({ title: "Kits", local_date: "2026-11-14", local_start_time: "09:00", location_id: "l1" });
    expect(buildAgendaBody({ ...values, status: "CANCELED" }).status).toBe("CANCELED");
    const initial = agendaToValues(item({}));
    expect(initial.local_start_time).toBe("07:00");
    expect(buildAgendaPatch(initial, initial)).toBeNull();
    expect(buildAgendaPatch(initial, { ...initial, status: "CANCELED" })).toEqual({ status: "CANCELED" });
    expect(buildAgendaPatch(initial, { ...initial, local_start_time: "07:30", local_end_time: "09:00" })).toEqual({ local_start_time: "07:30", local_end_time: "09:00" });
  });

  test("a saved optional value cannot be emptied from an edit", () => {
    const initial = agendaToValues(item({ description: "Con guardarropa", location_id: "l1" }));
    const errors = validateAgenda({ ...initial, description: "", location_id: "" }, initial);
    expect(errors.description).toBe(CANNOT_CLEAR);
    expect(errors.location_id).toBe(CANNOT_CLEAR);
  });

  test("days are ordered, and inside a day by start time, then order, then title; untimed entries go last", () => {
    const groups = groupAgendaByDate([
      item({ edition_schedule_item_id: "1", title: "Premiación", local_start_time: "10:30:00" }),
      item({ edition_schedule_item_id: "2", title: "Kits", local_date: "2026-11-14", local_start_time: "09:00:00" }),
      item({ edition_schedule_item_id: "3", title: "Salida", local_start_time: "07:00:00" }),
      item({ edition_schedule_item_id: "4", title: "Avisos", local_start_time: null }),
    ]);
    expect(groups.map((group) => group.date)).toEqual(["2026-11-14", "2026-11-15"]);
    expect(groups[1].items.map((entry) => entry.title)).toEqual(["Salida", "Premiación", "Avisos"]);
    expect(agendaTimeRange(item({ local_end_time: "09:00:00" }))).toBe("07:00 – 09:00");
    expect(agendaTimeRange(item({ local_start_time: null }))).toBe("Sin hora");
  });
});
