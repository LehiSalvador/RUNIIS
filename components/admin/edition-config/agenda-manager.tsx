"use client";

import React from "react";
import { CalendarClock, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { Panel } from "@/components/admin/panel";
import { InputField, SelectField, TextareaField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import type { FieldErrors } from "@/components/admin/events/form-logic";
import { AdminBadge } from "@/components/admin/status-badges";
import { formatCalendarDate } from "@/components/admin/format";
import { DeleteDialog } from "@/components/admin/edition-config/delete-dialog";
import {
  agendaTimeRange,
  agendaToValues,
  buildAgendaBody,
  buildAgendaPatch,
  emptyAgendaValues,
  groupAgendaByDate,
  validateAgenda,
  type AgendaRow,
  type AgendaValues,
} from "@/components/admin/edition-config/agenda-logic";

type Option = { id: string; name: string };

/** The programme of the event by day and hour (Master §44). Times are the wall-clock readings of the Edition's timezone. */
export function AgendaManager({
  editionId,
  timezone,
  raceDate,
  items,
  modalities,
  locations,
}: {
  editionId: string;
  timezone: string;
  /** The race date, offered as the default day of a new entry. */
  raceDate: string | null;
  items: readonly AgendaRow[];
  modalities: readonly Option[];
  locations: readonly Option[];
}) {
  const [editing, setEditing] = React.useState<AgendaRow | "new" | null>(null);
  const [removing, setRemoving] = React.useState<AgendaRow | null>(null);
  const modalityName = new Map(modalities.map((entry) => [entry.id, entry.name]));
  const locationName = new Map(locations.map((entry) => [entry.id, entry.name]));
  const days = groupAgendaByDate(items);

  return (
    <Panel
      title="Agenda del evento"
      description={`Horas locales de la edición (${timezone}). Una entrada cancelada se conserva marcada como cancelada; elimínala solo si ya no aplica.`}
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" />
          Agregar entrada
        </Button>
      }
    >
      {days.length === 0 ? (
        <p className="text-body-sm text-ink-60" data-testid="agenda-empty">
          Sin entradas todavía. Agrega, por ejemplo, la entrega de kits, la salida y la premiación.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {days.map((day) => (
            <section key={day.date} aria-label={formatCalendarDate(day.date)} data-agenda-date={day.date}>
              <h3 className="mb-1 text-body-sm font-bold text-ink">{formatCalendarDate(day.date)}</h3>
              <ul className="divide-y divide-divider rounded-control border border-divider">
                {day.items.map((item) => (
                  <li key={item.edition_schedule_item_id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2" data-agenda-title={item.title}>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-body-sm">
                        <CalendarClock className="size-4 shrink-0 text-ink-60" aria-hidden="true" />
                        <span className="tabular-nums text-ink-80">{agendaTimeRange(item)}</span>
                        <span className={item.status === "CANCELED" ? "font-semibold text-ink-60 line-through" : "font-semibold text-ink"}>{item.title}</span>
                        {item.status === "CANCELED" ? (
                          <AdminBadge icon={XCircle} tone="danger">
                            Cancelada
                          </AdminBadge>
                        ) : null}
                      </p>
                      <p className="text-caption text-ink-60">
                        {[
                          item.location_id ? (locationName.get(item.location_id) ?? "Ubicación") : null,
                          item.modality_id ? `Solo ${modalityName.get(item.modality_id) ?? "una modalidad"}` : "Para todos",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {item.description ? <p className="text-caption text-ink-80">{item.description}</p> : null}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(item)}>
                        <Pencil className="size-4" aria-hidden="true" />
                        Editar<span className="sr-only"> la entrada {item.title}</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(item)}>
                        <Trash2 className="size-4" aria-hidden="true" />
                        Eliminar<span className="sr-only"> la entrada {item.title}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editing ? (
        <AgendaDialog
          key={editing === "new" ? "new" : editing.edition_schedule_item_id}
          editionId={editionId}
          item={editing === "new" ? null : editing}
          raceDate={raceDate}
          modalities={modalities}
          locations={locations}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {removing ? (
        <DeleteDialog
          title={`Eliminar «${removing.title}»`}
          description="La entrada desaparece de la agenda. Si solo cambió el plan, es mejor marcarla como cancelada para que el público lo vea."
          endpoint={`/api/v1/admin/agenda/${removing.edition_schedule_item_id}`}
          confirmLabel="Eliminar entrada"
          successMessage="Entrada eliminada"
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Panel>
  );
}

function AgendaDialog({
  editionId,
  item,
  raceDate,
  modalities,
  locations,
  onClose,
}: {
  editionId: string;
  item: AgendaRow | null;
  raceDate: string | null;
  modalities: readonly Option[];
  locations: readonly Option[];
  onClose: () => void;
}) {
  const initial = React.useMemo<AgendaValues>(() => (item ? agendaToValues(item) : emptyAgendaValues(raceDate ?? "")), [item, raceDate]);
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const set = <K extends keyof AgendaValues>(key: K, value: AgendaValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const next = validateAgenda(values, item ? initial : undefined);
    setErrors(next);
    if (Object.values(next).some(Boolean)) return null;
    if (item) {
      const patch = buildAgendaPatch(initial, values);
      if (!patch) {
        setErrors({ title: "No hay cambios que guardar." });
        return null;
      }
      return apiFetch(`/api/v1/admin/agenda/${item.edition_schedule_item_id}`, { method: "PATCH", body: patch });
    }
    return apiFetch(`/api/v1/admin/editions/${editionId}/agenda`, { method: "POST", body: buildAgendaBody(values) });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={item ? `Editar ${item.title}` : "Agregar entrada a la agenda"}
      submitLabel={item ? "Guardar entrada" : "Agregar entrada"}
      successMessage={item ? "Entrada actualizada" : "Entrada agregada"}
      onSubmit={onSubmit}
      widthClassName="max-w-2xl"
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <InputField id="agenda-title" name="title" label="Título" required value={values.title} error={errors.title} maxLength={160} autoComplete="off" className="sm:col-span-2" onChange={(event) => set("title", event.target.value)} />
        <InputField id="agenda-date" name="local_date" type="date" label="Día" required value={values.local_date} error={errors.local_date} onChange={(event) => set("local_date", event.target.value)} />
        <SelectField
          id="agenda-status"
          name="status"
          label="Estado"
          value={values.status}
          options={[
            { value: "ACTIVE", label: "Activa" },
            { value: "CANCELED", label: "Cancelada" },
          ]}
          onChange={(event) => set("status", event.target.value === "CANCELED" ? "CANCELED" : "ACTIVE")}
        />
        <InputField id="agenda-start" name="local_start_time" type="time" label="Hora de inicio" value={values.local_start_time} error={errors.local_start_time} onChange={(event) => set("local_start_time", event.target.value)} />
        <InputField id="agenda-end" name="local_end_time" type="time" label="Hora de término" value={values.local_end_time} error={errors.local_end_time} onChange={(event) => set("local_end_time", event.target.value)} />
        <SelectField
          id="agenda-location"
          name="location_id"
          label="Ubicación"
          value={values.location_id}
          error={errors.location_id}
          options={[{ value: "", label: locations.length === 0 ? "Sin ubicaciones (agrégalas primero)" : "Sin ubicación" }, ...locations.map((entry) => ({ value: entry.id, label: entry.name }))]}
          onChange={(event) => set("location_id", event.target.value)}
        />
        <SelectField
          id="agenda-modality"
          name="modality_id"
          label="Modalidad"
          value={values.modality_id}
          error={errors.modality_id}
          options={[{ value: "", label: "Todas las modalidades" }, ...modalities.map((entry) => ({ value: entry.id, label: entry.name }))]}
          onChange={(event) => set("modality_id", event.target.value)}
        />
        <TextareaField id="agenda-description" name="description" label="Descripción" value={values.description} error={errors.description} maxLength={2000} className="sm:col-span-2" onChange={(event) => set("description", event.target.value)} />
        <InputField id="agenda-order" name="sort_order" label="Orden (desempate dentro del día)" inputMode="numeric" value={values.sort_order} error={errors.sort_order} autoComplete="off" onChange={(event) => set("sort_order", event.target.value)} />
      </div>
    </FormDialog>
  );
}
