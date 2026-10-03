"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, RotateCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCalendarDate } from "@/lib/client/account-format";
import type { RegistrationContext } from "@/lib/shared/registration-context";
import { MODE_LABELS } from "./logic/copy";
import type { BlockedState } from "./logic/availability";

/** Page header of /inscripcion/[slug]: the one h1, the edition and how this edition confirms. */
export function EditionHeader({ ctx }: { ctx: RegistrationContext }) {
  const { edition } = ctx;
  return (
    <header className="flex flex-col gap-3">
      <Link href={`/eventos/${edition.slug}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-body-sm font-semibold text-ink-80 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Volver al evento
      </Link>
      <h1 className="font-display text-h1 font-bold text-ink">Inscripción: {edition.name}</h1>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-80">
        {edition.sport_date ? <span>{formatCalendarDate(edition.sport_date, "long")}</span> : <span>Fecha por confirmar</span>}
        <span aria-hidden="true">·</span>
        <span>
          {edition.city}, {edition.state_region}
        </span>
        <span aria-hidden="true">·</span>
        <span className="font-semibold text-ink">{MODE_LABELS[edition.registration_mode]}</span>
      </p>
    </header>
  );
}

/** closed / not open / paused / canceled / sold out / temporarily unavailable: one distinct message each (S56). */
export function BlockedView({ state, onRefresh, refreshing, edition }: { state: BlockedState; onRefresh: () => void; refreshing: boolean; edition: Pick<RegistrationContext["edition"], "slug"> }) {
  return (
    <section aria-labelledby="blocked-heading" className="flex flex-col gap-4 rounded-panel border border-divider bg-paper-raised p-6 md:p-8" data-testid="registration-blocked">
      <StatusBadge state={state.badge} className="self-start" />
      <h2 id="blocked-heading" className="font-display text-h3 font-bold text-ink">
        {state.title}
      </h2>
      <p className="max-w-[var(--container-reading)] text-body text-ink-80" role="status">
        {state.body}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {state.canRefresh ? (
          <Button variant="secondary" loading={refreshing} onClick={onRefresh}>
            <RotateCw className="size-4" aria-hidden="true" />
            Actualizar disponibilidad
          </Button>
        ) : null}
        <Button asChild variant={state.canRefresh ? "ghost" : "secondary"}>
          <Link href={`/eventos/${edition.slug}`}>Ver la página del evento</Link>
        </Button>
      </div>
    </section>
  );
}

/** Confirmed registrations this buyer already holds for the edition (context.existing.registrations). */
export function ExistingRegistrations({ registrations }: { registrations: RegistrationContext["existing"]["registrations"] }) {
  if (registrations.length === 0) return null;
  return (
    <section aria-labelledby="existing-registrations-heading" className="flex flex-col gap-3 rounded-card border border-success-border bg-success-tint p-4 sm:p-5" data-testid="existing-registrations">
      <h2 id="existing-registrations-heading" className="text-h4 font-bold text-ink">
        Ya tienes inscripciones en este evento
      </h2>
      <ul className="divide-y divide-success-border/60 rounded-control bg-paper-raised">
        {registrations.map((registration) => (
          <li key={registration.registration_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
            <p className="flex items-center gap-2 text-body text-ink">
              <CircleCheck className="size-5 text-success" aria-hidden="true" />
              <span>
                <span className="font-semibold">{registration.participant_display_name ?? "Participante"}</span> · {registration.modality.name}{" "}
                <span className="text-body-sm text-ink-60 tabular-nums">({registration.registration_number})</span>
              </span>
            </p>
            {registration.participant_pass_id ? (
              <Link href={`/cuenta/pases/${registration.participant_pass_id}`} className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4">
                Ver pase<span className="sr-only"> de {registration.participant_display_name ?? "participante"}</span>
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-body-sm text-ink-80">Las personas que ya tienen lugar no aparecen como disponibles abajo.</p>
    </section>
  );
}

export function SessionExpiredAlert({ slug }: { slug: string }) {
  return (
    <Alert
      tone="warning"
      title="Tu sesión terminó"
      action={
        <Button asChild size="sm">
          <Link href={`/entrar?next=${encodeURIComponent(`/inscripcion/${slug}`)}`}>Iniciar sesión</Link>
        </Button>
      }
    >
      Inicia sesión de nuevo para continuar. Conservamos en este navegador lo que ya elegiste; los documentos legales los aceptas otra vez.
    </Alert>
  );
}
