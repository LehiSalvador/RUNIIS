"use client";

import React from "react";
import Link from "next/link";
import { BellOff } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import { AccountSection, RowList } from "@/components/account/section";
import { REMINDER_LABELS } from "@/components/account/favorites-list";
import { apiFetch } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import type { PreferencesView } from "@/lib/client/account-types";

type Purpose = keyof PreferencesView["purposes"];

// J10 step 3: each purpose is described by what it actually sends; nothing is pre-ticked for the
// person, and every change appends a new consent fact server-side (never edits an old one).
const PURPOSES: { key: Purpose; field: "event_reminder" | "general_marketing" | "other_optional"; title: string; body: string }[] = [
  {
    key: "EVENT_REMINDER",
    field: "event_reminder",
    title: "Recordatorios de carreras",
    body: "Aviso de apertura de inscripciones de las carreras donde activaste «Recordarme».",
  },
  {
    key: "GENERAL_MARKETING",
    field: "general_marketing",
    title: "Novedades de RUNIIS",
    body: "Nuevas carreras en tu zona y noticias de la comunidad.",
  },
  {
    key: "OTHER_OPTIONAL",
    field: "other_optional",
    title: "Otras comunicaciones opcionales",
    body: "Encuestas y comunicaciones no esenciales.",
  },
];

export function CommunicationPreferences({ initial }: { initial: PreferencesView }) {
  const [preferences, setPreferences] = React.useState(initial);
  const [saving, setSaving] = React.useState<Purpose | null>(null);
  const [canceling, setCanceling] = React.useState<string | null>(null);

  async function toggle(purpose: (typeof PURPOSES)[number], granted: boolean) {
    if (saving) return;
    setSaving(purpose.key);
    const result = await apiFetch<PreferencesView>("/api/v1/me/communication-preferences", {
      method: "PATCH",
      body: { [purpose.field]: granted },
    });
    setSaving(null);
    if (!result.ok) {
      toast({ tone: "danger", title: "No se guardó tu preferencia.", description: errorMessage(result) });
      return;
    }
    setPreferences(result.data);
    toast({ tone: "success", title: granted ? `Activaste: ${purpose.title}` : `Desactivaste: ${purpose.title}` });
  }

  async function cancelReminder(reminderId: string, name: string) {
    if (canceling) return;
    setCanceling(reminderId);
    const result = await apiFetch(`/api/v1/reminders/${reminderId}`, { method: "DELETE" });
    setCanceling(null);
    if (!result.ok) {
      toast({ tone: "danger", title: "No se pudo quitar el recordatorio.", description: errorMessage(result) });
      return;
    }
    setPreferences((current) => ({ ...current, reminders: current.reminders.filter((reminder) => reminder.reminder_id !== reminderId) }));
    toast({ tone: "info", title: `Ya no te recordaremos ${name}` });
  }

  const liveReminders = preferences.reminders.filter((reminder) => reminder.status === "ACTIVE" || reminder.status === "PENDING_CONFIRMATION");

  return (
    <div className="flex flex-col gap-10">
      {!preferences.contact.has_email ? (
        <Alert tone="warning" title="No tenemos un correo verificado para enviarte avisos." />
      ) : null}

      <AccountSection id="preferencias" title="Correos opcionales">
        <RowList label="Preferencias de correo">
          {PURPOSES.map((purpose) => {
            const state = preferences.purposes[purpose.key];
            const id = `pref-${purpose.field}`;
            return (
              <li key={purpose.key} className="flex items-start gap-2 p-4" data-testid={`preference-${purpose.field}`}>
                <Checkbox
                  id={id}
                  checked={state.granted}
                  disabled={saving !== null}
                  aria-describedby={`${id}-desc`}
                  onCheckedChange={(value) => toggle(purpose, value === true)}
                  className="-my-2.5 -ml-2.5"
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={id} className="text-body font-semibold text-ink">
                    {purpose.title}
                  </label>
                  <p id={`${id}-desc`} className="text-body-sm text-ink-60">
                    {purpose.body}
                    {state.granted && state.suppressed
                      ? " Ahora no podemos enviarte estos correos porque tu dirección rebotó o se dio de baja desde un enlace."
                      : ""}
                  </p>
                  <p className="mt-1 text-caption font-semibold text-ink-80" aria-live="polite">
                    {saving === purpose.key ? "Guardando…" : state.effective ? "Activado" : "Desactivado"}
                  </p>
                </div>
              </li>
            );
          })}
        </RowList>
      </AccountSection>

      <AccountSection id="recordatorios" title="Recordatorios activos">
        {liveReminders.length === 0 ? (
          <p className="rounded-card border border-dashed border-divider px-5 py-4 text-body-sm text-ink-60">
            No tienes recordatorios. Actívalos desde{" "}
            <Link href="/cuenta/favoritos" className="font-semibold text-ink underline underline-offset-4">
              Favoritos
            </Link>{" "}
            o desde la página de una carrera.
          </p>
        ) : (
          <RowList label="Recordatorios">
            {liveReminders.map((reminder) => (
              <li key={reminder.reminder_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="reminder-row">
                <div className="min-w-0">
                  <Link href={`/eventos/${reminder.slug}`} className="text-body font-semibold text-ink hover:underline hover:underline-offset-4">
                    {reminder.name}
                  </Link>
                  <p className="text-body-sm text-ink-60">{REMINDER_LABELS[reminder.status] ?? reminder.status}</p>
                </div>
                <Button size="sm" variant="secondary" loading={canceling === reminder.reminder_id} onClick={() => cancelReminder(reminder.reminder_id, reminder.name)}>
                  <BellOff className="size-4" aria-hidden="true" />
                  Quitar<span className="sr-only"> recordatorio de {reminder.name}</span>
                </Button>
              </li>
            ))}
          </RowList>
        )}
      </AccountSection>
    </div>
  );
}
