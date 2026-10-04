"use client";

import React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { InputField, SelectField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";

type EventTypeOption = { key: string; name: string };

/** Rename the Event the Edition belongs to and change its type (ADMIN only; the canonical key never changes). */
export function EventEditButton({
  eventId,
  name,
  eventTypeKey,
  eventTypes,
}: {
  eventId: string;
  name: string;
  eventTypeKey: string;
  eventTypes: readonly EventTypeOption[];
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden="true" />
        Editar evento
      </Button>
      {open ? <EventDialog eventId={eventId} name={name} eventTypeKey={eventTypeKey} eventTypes={eventTypes} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function EventDialog({
  eventId,
  name,
  eventTypeKey,
  eventTypes,
  onClose,
}: {
  eventId: string;
  name: string;
  eventTypeKey: string;
  eventTypes: readonly EventTypeOption[];
  onClose: () => void;
}) {
  const [value, setValue] = React.useState(name);
  const [typeKey, setTypeKey] = React.useState(eventTypeKey);
  const [error, setError] = React.useState<string | undefined>();
  // The current type stays selectable even if it is no longer in the active list, so opening the dialog never changes it by accident.
  const options = eventTypes.some((type) => type.key === eventTypeKey) ? eventTypes : [...eventTypes, { key: eventTypeKey, name: eventTypeKey }];

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const next = value.trim();
    if (!next) {
      setError("Este campo es obligatorio.");
      return null;
    }
    const body: Record<string, string> = {};
    if (next !== name) body.name = next;
    if (typeKey !== eventTypeKey) body.event_type_key = typeKey;
    if (Object.keys(body).length === 0) {
      setError("No hay cambios que guardar.");
      return null;
    }
    setError(undefined);
    return apiFetch(`/api/v1/admin/events/${eventId}`, { method: "PATCH", body });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Editar evento"
      description="El nombre y el tipo son comunes a todas las ediciones del evento. Su clave permanente no cambia."
      submitLabel="Guardar evento"
      successMessage="Evento actualizado"
      onSubmit={onSubmit}
    >
      <InputField
        id="event-rename"
        name="name"
        label="Nombre del evento"
        required
        value={value}
        error={error}
        maxLength={160}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
      />
      <SelectField
        id="event-retype"
        name="event_type_key"
        label="Tipo de evento"
        value={typeKey}
        options={options.map((type) => ({ value: type.key, label: type.name }))}
        onChange={(event) => setTypeKey(event.target.value)}
      />
    </FormDialog>
  );
}
