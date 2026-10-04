import React from "react";
import { Panel, DefinitionList } from "@/components/admin/panel";
import { formatCalendarDate, formatClock, formatDateTime } from "@/components/admin/format";

export type ScheduleRevisionView = {
  revision: number;
  schedule_state: string;
  local_date: string | null;
  local_start_time: string | null;
  local_end_time: string | null;
  timezone: string;
  effective_start_at: string | null;
  effective_end_at: string | null;
  created_at: string;
} | null;

const STATE_LABEL: Record<string, string> = {
  POSTPONED_NO_NEW_DATE: "Aplazada, sin nueva fecha",
  DATE_CONFIRMED_TIME_PENDING: "Fecha confirmada, hora por definir",
  DATE_TIME_CONFIRMED: "Fecha y hora confirmadas",
};

/**
 * Calendar of the race as the server holds it (Master §29). Every change of the date goes through Aplazar / Reprogramar (or the time
 * edit of Datos y fechas), and each creates a new numbered revision: this panel shows the one in force and how many came before it.
 */
export function ScheduleRevisionPanel({ schedule, timezone, executionState }: { schedule: ScheduleRevisionView; timezone: string; executionState: string }) {
  if (!schedule) {
    return (
      <Panel title="Calendario y revisiones" description={`Horas en la zona de la edición (${timezone}).`}>
        <p className="text-body-sm text-ink-60">La edición todavía no tiene calendario. Define la fecha en Datos y fechas.</p>
      </Panel>
    );
  }
  const earlier = Math.max(schedule.revision - 1, 0);
  const range = schedule.local_start_time
    ? `${formatClock(schedule.local_start_time)}${schedule.local_end_time ? ` – ${formatClock(schedule.local_end_time)}` : ""}`
    : "Hora por definir";
  return (
    <Panel
      title="Calendario y revisiones"
      description={`Horas en la zona de la edición (${timezone}). Cambiar la fecha crea una revisión nueva.`}
    >
      <div className="flex flex-col gap-3" data-testid="schedule-revision">
        <DefinitionList
          columns={3}
          items={[
            { label: "Revisión vigente", value: <span className="font-semibold tabular-nums">Revisión {schedule.revision}</span> },
            { label: "Estado del calendario", value: STATE_LABEL[schedule.schedule_state] ?? schedule.schedule_state },
            { label: "Fecha", value: schedule.local_date ? formatCalendarDate(schedule.local_date) : "Sin fecha" },
            { label: "Horario", value: range },
            { label: "Inicio efectivo", value: formatDateTime(schedule.effective_start_at, timezone) },
            { label: "Vigente desde", value: formatDateTime(schedule.created_at, timezone) },
          ]}
        />
        <p className="text-body-sm text-ink-80" data-testid="schedule-earlier">
          {earlier === 0
            ? "Es el calendario original: todavía no hubo aplazamientos ni reprogramaciones."
            : `Antes de esta hubo ${earlier} ${earlier === 1 ? "revisión" : "revisiones"} del calendario.`}
        </p>
        {executionState === "SCHEDULED" || executionState === "POSTPONED" ? (
          <p className="text-caption text-ink-60">
            Para mover la fecha usa «{executionState === "POSTPONED" ? "Reprogramar fecha" : "Aplazar carrera» o «Reprogramar fecha"}» en Estado y publicación: piden el motivo y quedan en la bitácora de auditoría.
          </p>
        ) : (
          <p className="text-caption text-ink-60">Con la carrera iniciada, terminada o cancelada el calendario ya no se mueve.</p>
        )}
        {earlier > 0 ? (
          <p className="text-caption text-ink-60" data-testid="schedule-history-note">
            El detalle de las revisiones anteriores (fecha y motivo de cada una) todavía no se puede consultar desde el panel.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
