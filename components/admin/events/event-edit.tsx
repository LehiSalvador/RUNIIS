"use client";

import React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { InputField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";

/** Rename the Event the Edition belongs to (ADMIN only; the canonical key never changes). */
export function EventEditButton({ eventId, name }: { eventId: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden="true" />
        Renombrar evento
      </Button>
      {open ? <EventDialog eventId={eventId} name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function EventDialog({ eventId, name, onClose }: { eventId: string; name: string; onClose: () => void }) {
  const [value, setValue] = React.useState(name);
  const [error, setError] = React.useState<string | undefined>();

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const next = value.trim();
    if (!next) {
      setError("Este campo es obligatorio.");
      return null;
    }
    if (next === name) {
      setError("No hay cambios que guardar.");
      return null;
    }
    setError(undefined);
    return apiFetch(`/api/v1/admin/events/${eventId}`, { method: "PATCH", body: { name: next } });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Renombrar evento"
      description="El nombre del evento es común a todas sus ediciones. Su clave permanente no cambia."
      submitLabel="Guardar nombre"
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
    </FormDialog>
  );
}
