import type { JsonObject } from "@/lib/shared/api-contract";
import type { FieldErrors } from "@/components/admin/events/form-logic";
import { CANNOT_CLEAR } from "@/components/admin/edition-config/location-logic";

/**
 * Pure logic of the Edition agenda screen (P3-E2, Master §44). Times are local wall-clock readings in the Edition's timezone
 * (the agenda stores no instants). Edge validation only; the database stays the authority.
 */

export type AgendaRow = {
  edition_schedule_item_id: string;
  modality_id: string | null;
  title: string;
  description: string | null;
  local_date: string;
  local_start_time: string | null;
  local_end_time: string | null;
  location_id: string | null;
  sort_order: number;
  status: "ACTIVE" | "CANCELED";
};

export type AgendaValues = {
  title: string;
  description: string;
  local_date: string;
  local_start_time: string;
  local_end_time: string;
  modality_id: string;
  location_id: string;
  sort_order: string;
  status: "ACTIVE" | "CANCELED";
};

export function emptyAgendaValues(localDate = ""): AgendaValues {
  return { title: "", description: "", local_date: localDate, local_start_time: "", local_end_time: "", modality_id: "", location_id: "", sort_order: "", status: "ACTIVE" };
}

function toTime(value: string | null): string {
  const match = value ? /^(\d{2}):(\d{2})/.exec(value) : null;
  return match ? `${match[1]}:${match[2]}` : "";
}

export function agendaToValues(row: AgendaRow): AgendaValues {
  return {
    title: row.title,
    description: row.description ?? "",
    local_date: row.local_date,
    local_start_time: toTime(row.local_start_time),
    local_end_time: toTime(row.local_end_time),
    modality_id: row.modality_id ?? "",
    location_id: row.location_id ?? "",
    sort_order: String(row.sort_order),
    status: row.status,
  };
}

export function validateAgenda(values: AgendaValues, initial?: AgendaValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.title.trim()) errors.title = "Este campo es obligatorio.";
  else if (values.title.trim().length > 160) errors.title = "Máximo 160 caracteres.";
  if (values.description.length > 2000) errors.description = "Máximo 2000 caracteres.";
  if (!values.local_date) errors.local_date = "Indica la fecha.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.local_date)) errors.local_date = "Fecha no válida.";
  if (values.local_end_time && !values.local_start_time) errors.local_end_time = "Indica primero la hora de inicio.";
  else if (values.local_start_time && values.local_end_time && values.local_end_time <= values.local_start_time) {
    errors.local_end_time = "La hora de término debe ser posterior a la de inicio.";
  }
  if (values.sort_order.trim() !== "" && !/^\d{1,5}$/.test(values.sort_order.trim())) errors.sort_order = "Número entero, 0 o mayor.";
  if (initial) {
    for (const field of ["description", "local_start_time", "local_end_time", "modality_id", "location_id"] as const) {
      if (initial[field].trim() !== "" && values[field].trim() === "" && !errors[field]) errors[field] = CANNOT_CLEAR;
    }
  }
  return errors;
}

export function buildAgendaBody(values: AgendaValues): JsonObject {
  const body: JsonObject = { title: values.title.trim(), local_date: values.local_date };
  if (values.description.trim()) body.description = values.description.trim();
  if (values.local_start_time) body.local_start_time = values.local_start_time;
  if (values.local_end_time) body.local_end_time = values.local_end_time;
  if (values.modality_id) body.modality_id = values.modality_id;
  if (values.location_id) body.location_id = values.location_id;
  if (values.sort_order.trim()) body.sort_order = Number(values.sort_order);
  if (values.status !== "ACTIVE") body.status = values.status;
  return body;
}

export function buildAgendaPatch(initial: AgendaValues, values: AgendaValues): JsonObject | null {
  const patch: JsonObject = {};
  if (values.title.trim() !== initial.title) patch.title = values.title.trim();
  if (values.description.trim() !== initial.description.trim() && values.description.trim()) patch.description = values.description.trim();
  if (values.local_date !== initial.local_date) patch.local_date = values.local_date;
  if (values.local_start_time !== initial.local_start_time && values.local_start_time) patch.local_start_time = values.local_start_time;
  if (values.local_end_time !== initial.local_end_time && values.local_end_time) patch.local_end_time = values.local_end_time;
  if (values.modality_id !== initial.modality_id && values.modality_id) patch.modality_id = values.modality_id;
  if (values.location_id !== initial.location_id && values.location_id) patch.location_id = values.location_id;
  if (values.sort_order.trim() !== initial.sort_order.trim() && values.sort_order.trim()) patch.sort_order = Number(values.sort_order);
  if (values.status !== initial.status) patch.status = values.status;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Items grouped by calendar date (ascending), each day ordered by start time, then sort order, then title. */
export function groupAgendaByDate(items: readonly AgendaRow[]): { date: string; items: AgendaRow[] }[] {
  const byDate = new Map<string, AgendaRow[]>();
  for (const item of items) byDate.set(item.local_date, [...(byDate.get(item.local_date) ?? []), item]);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      date,
      items: rows.sort(
        (a, b) =>
          (a.local_start_time ?? "99:99").localeCompare(b.local_start_time ?? "99:99") ||
          a.sort_order - b.sort_order ||
          a.title.localeCompare(b.title, "es"),
      ),
    }));
}

export function agendaTimeRange(item: Pick<AgendaRow, "local_start_time" | "local_end_time">): string {
  const start = toTime(item.local_start_time);
  const end = toTime(item.local_end_time);
  if (start && end) return `${start} – ${end}`;
  return start || "Sin hora";
}
