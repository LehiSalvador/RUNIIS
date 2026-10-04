"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import type { JsonObject } from "@/lib/shared/api-contract";
import { Panel } from "@/components/admin/panel";
import { FormDialog } from "@/components/admin/events/form-dialog";
import { InputField, SelectField, TextareaField } from "@/components/admin/events/fields";
import { toTimeInput, zonedLocalToIso } from "@/components/admin/events/form-logic";
import { readinessFix } from "@/components/admin/edition-config/config-model";
import {
  editionTransitions,
  type EditionStates,
  type ReadinessView,
  type TransitionAvailability,
  type TransitionId,
} from "@/components/admin/events/transitions";

export type LifecycleSchedule = { local_date: string | null; local_start_time: string | null; local_end_time: string | null } | null;

const GROUP_TITLE = {
  publication: "Publicación",
  registration: "Inscripciones",
  execution: "Ejecución de la carrera",
} as const;

const SUCCESS: Record<TransitionId, string> = {
  publish: "Edición publicada",
  hide: "Edición oculta",
  "open-registration": "Inscripciones abiertas",
  "pause-registration": "Inscripciones en pausa",
  "resume-registration": "Inscripciones reanudadas",
  "close-registration": "Inscripciones cerradas",
  postpone: "Carrera aplazada",
  reschedule: "Carrera reprogramada",
  cancel: "Edición cancelada",
  start: "Carrera iniciada",
  finish: "Carrera finalizada",
};

/**
 * "Estado y publicación": every transition with its precondition and, for publish / open / resume, the missing
 * items the SERVER reported in the editor projection. The publish button is disabled while the server says the
 * Edition is not ready, and the list of what is missing sits right next to it. The click still goes to the API,
 * which re-checks everything and answers with its own refusal (shown through RefusalNotice).
 */
export function LifecyclePanel({
  editionId,
  states,
  readiness,
  timezone,
  schedule,
  isAdmin,
  updatedAt,
}: {
  editionId: string;
  states: EditionStates;
  readiness: { publication: ReadinessView; registration: ReadinessView };
  timezone: string;
  schedule: LifecycleSchedule;
  isAdmin: boolean;
  /** `edition.updated_at` exactly as read: sent as `expected_updated_at` with every transition (P3-L). */
  updatedAt: string;
}) {
  const [active, setActive] = React.useState<TransitionAvailability | null>(null);
  const items = React.useMemo(() => editionTransitions(states, readiness), [states, readiness]);
  const applicable = items.filter((item) => item.applicable);
  const unavailable = items.filter((item) => !item.applicable);

  return (
    <Panel
      title="Estado y publicación"
      description={
        isAdmin
          ? "Cada acción muestra lo que necesita. El servidor vuelve a comprobarlo al ejecutarla."
          : "Solo un administrador puede cambiar el estado de la edición. Aquí ves qué falta."
      }
    >
      <div className="flex flex-col gap-5">
        {(Object.keys(GROUP_TITLE) as (keyof typeof GROUP_TITLE)[]).map((group) => {
          const rows = applicable.filter((item) => item.spec.group === group);
          if (rows.length === 0) return null;
          return (
            <section key={group} aria-label={GROUP_TITLE[group]} className="flex flex-col gap-3">
              <h3 className="text-label font-semibold uppercase tracking-wide text-ink-60">{GROUP_TITLE[group]}</h3>
              <ul className="flex flex-col gap-3">
                {rows.map((item) => (
                  <TransitionRow key={item.spec.id} editionId={editionId} item={item} isAdmin={isAdmin} onOpen={() => setActive(item)} />
                ))}
              </ul>
            </section>
          );
        })}

        {unavailable.length > 0 ? (
          <details className="rounded-control border border-divider px-3 py-2">
            <summary className="cursor-pointer text-body-sm font-semibold text-ink">
              Otras acciones que no aplican ahora ({unavailable.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {unavailable.map((item) => (
                <li key={item.spec.id} className="text-body-sm text-ink-80">
                  <span className="font-semibold text-ink">{item.spec.label}:</span> {item.stateReason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {active ? (
        <TransitionDialog
          key={active.spec.id}
          editionId={editionId}
          item={active}
          timezone={timezone}
          schedule={schedule}
          updatedAt={updatedAt}
          onClose={() => setActive(null)}
        />
      ) : null}
    </Panel>
  );
}

function TransitionRow({ editionId, item, isAdmin, onOpen }: { editionId: string; item: TransitionAvailability; isAdmin: boolean; onOpen: () => void }) {
  const { spec, blockedBy, enabled } = item;
  const noteId = `transition-${spec.id}-note`;
  return (
    <li className="flex flex-col gap-2 rounded-control border border-divider p-3 sm:flex-row sm:items-start sm:justify-between" data-transition={spec.id}>
      <div className="min-w-0">
        <p className="text-body-sm font-semibold text-ink">{spec.label}</p>
        <p className="text-caption text-ink-60">{spec.precondition}</p>
        {blockedBy.length > 0 ? (
          <div id={noteId} className="mt-2" data-testid={`blocked-${spec.id}`}>
            <p className="text-body-sm font-semibold text-danger">
              No se puede todavía. Falta resolver {blockedBy.length === 1 ? "1 requisito" : `${blockedBy.length} requisitos`}:
            </p>
            <ul className="mt-1 list-disc pl-6 text-body-sm text-ink-80">
              {blockedBy.map((check) => {
                const fix = readinessFix(editionId, check.code);
                return (
                  <li key={check.code}>
                    {check.label}
                    {fix ? (
                      <>
                        {" · "}
                        <a href={fix.href} className="underline underline-offset-2">
                          Resolver en {fix.label}
                        </a>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
      <Button
        variant={spec.tone === "danger" ? "secondary" : "primary"}
        size="sm"
        className="shrink-0"
        disabled={!enabled || !isAdmin}
        aria-describedby={blockedBy.length > 0 ? noteId : undefined}
        onClick={onOpen}
      >
        {spec.label}
      </Button>
    </li>
  );
}

function TransitionDialog({
  editionId,
  item,
  timezone,
  schedule,
  updatedAt,
  onClose,
}: {
  editionId: string;
  item: TransitionAvailability;
  timezone: string;
  schedule: LifecycleSchedule;
  updatedAt: string;
  onClose: () => void;
}) {
  const { spec } = item;
  const [reason, setReason] = React.useState("");
  const [registrationAction, setRegistrationAction] = React.useState("PAUSE");
  const [date, setDate] = React.useState(schedule?.local_date ?? "");
  const [start, setStart] = React.useState(toTimeInput(schedule?.local_start_time));
  const [end, setEnd] = React.useState(toTimeInput(schedule?.local_end_time));
  const [closeAt, setCloseAt] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({});

  const needsReason = spec.fields !== "none";

  async function onSubmit({ idempotencyKey }: { idempotencyKey: string }): Promise<ApiResult<unknown> | null> {
    const next: Record<string, string | undefined> = {};
    if (needsReason && reason.trim().length < 3) next.reason = "Indica el motivo (mínimo 3 caracteres).";
    if (spec.fields === "reschedule") {
      if (!date) next.local_date = "Indica la nueva fecha.";
      if (end && !start) next.local_end_time = "Indica primero la hora de inicio.";
      if (start && end && end <= start) next.local_end_time = "La hora de término debe ser posterior a la de inicio.";
      if (closeAt && !zonedLocalToIso(closeAt, timezone)) next.registration_close_at = "Fecha y hora no válidas.";
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return null;

    // The version the operator is looking at: if the Edition changed meanwhile the server refuses with 409 STALE_STATE.
    const body: JsonObject = { expected_updated_at: updatedAt };
    if (needsReason) body.reason = reason.trim();
    if (spec.fields === "postpone") body.registration_action = registrationAction;
    if (spec.fields === "reschedule") {
      body.local_date = date;
      if (start) body.local_start_time = start;
      if (end) body.local_end_time = end;
      const iso = closeAt ? zonedLocalToIso(closeAt, timezone) : null;
      if (iso) body.registration_close_at = iso;
    }
    return apiFetch(`/api/v1/admin/editions/${editionId}/${spec.endpoint}`, { method: "POST", body, idempotencyKey });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={spec.label}
      description={spec.consequence}
      submitLabel={spec.confirmLabel}
      successMessage={SUCCESS[spec.id]}
      tone={spec.tone}
      onSubmit={onSubmit}
    >
      <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-caption text-ink-80">{spec.precondition}</p>
      {needsReason ? (
        <TextareaField
          id="transition-reason"
          name="reason"
          label="Motivo"
          required
          value={reason}
          error={errors.reason}
          maxLength={500}
          helperText="Queda en la bitácora de auditoría."
          onChange={(event) => setReason(event.target.value)}
        />
      ) : null}
      {spec.fields === "postpone" ? (
        <SelectField
          id="transition-registration-action"
          name="registration_action"
          label="Inscripciones mientras no haya nueva fecha"
          value={registrationAction}
          options={[
            { value: "PAUSE", label: "Pausarlas (se pueden reanudar)" },
            { value: "CLOSE", label: "Cerrarlas" },
          ]}
          onChange={(event) => setRegistrationAction(event.target.value)}
        />
      ) : null}
      {spec.fields === "reschedule" ? (
        <div className="grid gap-x-4 sm:grid-cols-3">
          <InputField id="transition-date" name="local_date" type="date" label="Nueva fecha" required value={date} error={errors.local_date} onChange={(event) => setDate(event.target.value)} />
          <InputField id="transition-start" name="local_start_time" type="time" label="Hora de inicio" value={start} onChange={(event) => setStart(event.target.value)} />
          <InputField id="transition-end" name="local_end_time" type="time" label="Hora de término" value={end} error={errors.local_end_time} onChange={(event) => setEnd(event.target.value)} />
          <InputField
            id="transition-close"
            name="registration_close_at"
            type="datetime-local"
            label="Cierre de inscripciones"
            value={closeAt}
            error={errors.registration_close_at}
            helperText={`Opcional, hora de ${timezone}. Vacío: se recalcula con la nueva fecha.`}
            className="sm:col-span-3"
            onChange={(event) => setCloseAt(event.target.value)}
          />
        </div>
      ) : null}
    </FormDialog>
  );
}
