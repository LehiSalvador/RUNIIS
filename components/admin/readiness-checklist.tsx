import React from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * ui-spec §3.11 readiness panel body: explicit pass/fail rows (never a single toggle), one per condition
 * with icon + exact condition text. Failing rows are grouped above passing ones so blockers come first.
 * Read-only here: the Edition editor (P3-E) wires the publish / open-registration actions to `ready`.
 */
export type ReadinessCheck = { code: string; ok: boolean };

export const READINESS_LABEL: Record<string, string> = {
  EVENT_ACTIVE: "El evento está activo",
  EVENT_TYPE_ACTIVE: "El tipo de evento está activo",
  SLUG_VALID: "Enlace público (slug) válido",
  TIMEZONE_VALID: "Zona horaria válida",
  CITY_PRESENT: "Ciudad y estado capturados",
  DATE_KNOWN: "Fecha de la carrera definida",
  MODALITY_PRESENT: "Al menos una modalidad",
  MAIN_IMAGE: "Imagen principal",
  DESCRIPTION_PRESENT: "Descripción mínima",
  STATES_COHERENT: "Estados coherentes entre sí",
  EDITION_PUBLISHED: "Edición publicada",
  EXECUTION_SCHEDULED: "Ejecución programada",
  SCHEDULE_DATE_VALID: "Fecha de calendario válida",
  REGISTRATION_OPEN_AT_REACHED: "Ya llegó la fecha de apertura de inscripciones",
  REGISTRATION_CLOSE_AT_FUTURE: "El cierre de inscripciones está en el futuro",
  ACTIVE_MODALITY: "Al menos una modalidad activa",
  OFFICIAL_DISTANCE_FOR_CREDIT: "Distancia oficial en modalidades que acreditan distancia",
  CAPACITY_VALID: "Capacidad válida",
  PRICE_VALID: "Precio válido o gratuito explícito",
  ELIGIBILITY_RULES_VALID: "Reglas de elegibilidad válidas",
  FORM_PUBLISHED: "Formulario de inscripción publicado",
  WHATSAPP_CONFIGURED: "WhatsApp configurado (inscripción por WhatsApp)",
  LEGAL_DOCUMENTS_PUBLISHED: "Documentos legales publicados",
};

export function readinessLabel(code: string): string {
  return READINESS_LABEL[code] ?? code.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function ReadinessChecklist({
  title,
  ready,
  checks,
}: {
  title: string;
  ready: boolean;
  checks: readonly ReadinessCheck[];
}) {
  const failing = checks.filter((check) => !check.ok);
  const passing = checks.filter((check) => check.ok);
  return (
    <div>
      <p className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-ink">
        {title}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-semibold",
            ready ? "border-success-border bg-success-tint text-success" : "border-warning-border bg-warning-tint text-warning",
          )}
        >
          {ready ? (
            <CircleCheck className="size-3.5" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-3.5" aria-hidden="true" />
          )}
          {ready ? "Lista" : `${failing.length} por resolver`}
        </span>
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {[...failing, ...passing].map((check) => (
          <li key={check.code} className="flex items-start gap-2 text-body-sm">
            {check.ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
            )}
            <span className={check.ok ? "text-ink-80" : "font-semibold text-ink"}>
              <span className="sr-only">{check.ok ? "Cumple: " : "Pendiente: "}</span>
              {readinessLabel(check.code)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
