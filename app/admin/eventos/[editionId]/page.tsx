import type { Metadata } from "next";
import Link from "next/link";
import React, { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { CapacitySummary } from "@/components/admin/capacity";
import { DataFreshness } from "@/components/admin/data-freshness";
import { editionQuickLinks } from "@/components/admin/edition-links";
import { ErrorNotice } from "@/components/admin/error-notice";
import { formatCalendarDate, formatClock, formatDateTime } from "@/components/admin/format";
import { DefinitionList, Panel } from "@/components/admin/panel";
import { EditionSubnav } from "@/components/admin/events/edition-subnav";
import { LifecyclePanel } from "@/components/admin/events/lifecycle-panel";
import { canManageLifecycle } from "@/components/admin/events/permissions";
import { ReadinessChecklist } from "@/components/admin/readiness-checklist";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { CLOSURE_LABEL, ExecutionBadge, PublicationBadge, RegistrationBadge } from "@/components/admin/status-badges";
import { buttonVariants } from "@/components/ui/button";
import { adminGetEditionEditor } from "@/lib/server/domain/events/service";
import type { StaffAssignment } from "@/components/admin/access";
import { requireStaff, settle } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Edición" };

const SCHEDULE_STATE: Record<string, string> = {
  POSTPONED_NO_NEW_DATE: "Aplazada, sin nueva fecha",
  DATE_CONFIRMED_TIME_PENDING: "Fecha confirmada, hora por definir",
  DATE_TIME_CONFIRMED: "Fecha y hora confirmadas",
};

const MODE_LABEL: Record<string, string> = {
  FREE: "Gratuita: confirma al instante",
  EXTERNAL_WHATSAPP: "Por WhatsApp: el staff confirma cada solicitud",
};

const MODALITY_STATUS: Record<string, string> = { ACTIVE: "Activa", CLOSED: "Cerrada", CANCELED: "Cancelada" };

export default async function AdminEditionOverviewPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}`, "eventos", { editionId });
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  // A malformed id can never name an Edition; answer "not found" without a database round trip.
  if (!z.guid().safeParse(editionId).success) {
    return (
      <AdminPage assignments={assignments} title="Edición" actions={<BackToList />}>
        <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
      </AdminPage>
    );
  }

  return (
    <Suspense
      fallback={
        <AdminPage assignments={assignments} title="Edición" actions={<BackToList />}>
          <PanelsSkeleton count={4} label="Cargando edición" />
        </AdminPage>
      }
    >
      <EditionOverview supabase={supabase} assignments={assignments} editionId={editionId} />
    </Suspense>
  );
}

function BackToList() {
  return (
    <Link href="/admin/eventos" prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Todas las ediciones
    </Link>
  );
}

async function EditionOverview({
  supabase,
  assignments,
  editionId,
}: {
  supabase: SupabaseClient;
  assignments: StaffAssignment[];
  editionId: string;
}) {
  const result = await settle(adminGetEditionEditor(supabase, editionId), "events.overview");

  if (!result.ok) {
    return (
      <AdminPage assignments={assignments} title="Edición" actions={<BackToList />}>
        {result.code === "NOT_FOUND" ? (
          <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
        ) : (
          <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar la edición." />
        )}
      </AdminPage>
    );
  }

  const { edition, availability, readiness, modalities } = result.data;
  const zone = edition.timezone;
  const schedule = edition.schedule;
  const links = editionQuickLinks(edition.edition_id, assignments);
  const isAdmin = canManageLifecycle(assignments, edition.edition_id);
  const modalityNames = Object.fromEntries(modalities.map((modality) => [modality.modality_id, modality.name]));

  return (
    <AdminPage
      assignments={assignments}
      title={edition.name}
      actions={
        <>
          <BackToList />
          {edition.publication_state === "PUBLISHED" ? (
            <Link
              href={`/eventos/${edition.slug}`}
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Ver en el sitio
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </Link>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <EditionSubnav editionId={edition.edition_id} current="resumen" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2" aria-label="Estado de la edición" role="group">
            <PublicationBadge value={edition.publication_state} />
            <RegistrationBadge value={edition.registration_state} />
            <ExecutionBadge value={edition.execution_state} />
            <span className="text-caption text-ink-60">Cierre administrativo: {CLOSURE_LABEL[edition.closure_state] ?? edition.closure_state}</span>
          </div>
          <DataFreshness loadedAt={new Date().toISOString()} timeZone={zone} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Fechas clave" description={`Horas en la zona de la edición (${zone}).`}>
            <DefinitionList
              items={[
                {
                  label: "Carrera",
                  value: schedule?.local_date
                    ? `${formatCalendarDate(schedule.local_date)}${schedule.local_start_time ? ` · ${formatClock(schedule.local_start_time)}` : ""}`
                    : "Sin fecha",
                },
                { label: "Estado del calendario", value: schedule ? (SCHEDULE_STATE[schedule.schedule_state] ?? schedule.schedule_state) : "Sin calendario" },
                { label: "Apertura de inscripciones", value: edition.registration_open_at ? formatDateTime(edition.registration_open_at, zone) : "Sin fecha de apertura" },
                { label: "Cierre de inscripciones", value: formatDateTime(edition.registration_close_at, zone) },
                { label: "Publicada", value: formatDateTime(edition.published_at, zone) },
                { label: "Última actualización", value: formatDateTime(edition.updated_at, zone) },
              ]}
            />
          </Panel>

          <Panel title="Inscripción">
            <DefinitionList
              items={[
                { label: "Estado", value: <RegistrationBadge value={edition.registration_state} /> },
                { label: "Modo", value: MODE_LABEL[edition.registration_mode] ?? edition.registration_mode },
                {
                  label: "WhatsApp de la edición",
                  value:
                    edition.registration_mode === "EXTERNAL_WHATSAPP"
                      ? (edition.whatsapp_phone_e164 ?? "Sin número configurado")
                      : "No aplica",
                },
                { label: "Sede", value: `${edition.city}, ${edition.state_region}, ${edition.country_code}` },
                { label: "Evento a beneficio", value: edition.is_benefit_event ? "Sí" : "No" },
                { label: "Enlace público", value: <span className="font-mono text-caption">/eventos/{edition.slug}</span> },
              ]}
            />
          </Panel>

          <Panel title="Capacidad" description="Confirmados + apartados vigentes frente a la capacidad. Derivado, no un contador guardado.">
            <CapacitySummary availability={availability} modalityNames={modalityNames} />
          </Panel>

          <Panel title="Modalidades">
            {modalities.length === 0 ? (
              <p className="text-body-sm text-ink-60">Esta edición todavía no tiene modalidades.</p>
            ) : (
              <ul className="divide-y divide-divider">
                {modalities.map((modality) => (
                  <li key={modality.modality_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0">
                    <span className="font-semibold text-ink">{modality.name}</span>
                    <span className="text-caption tabular-nums text-ink-60">
                      {modality.official_distance_m ? `${(modality.official_distance_m / 1000).toLocaleString("es-MX")} km` : "Sin distancia oficial"}
                      {modality.local_start_time ? ` · ${formatClock(modality.local_start_time)}` : ""}
                      {` · ${MODALITY_STATUS[modality.status] ?? modality.status}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          title="Readiness"
          description="Todo lo que falta para publicar y para abrir inscripciones, según el servidor. Se recalcula en cada lectura."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <ReadinessChecklist title="Publicación" ready={readiness.publication.ready} checks={readiness.publication.checks} />
            <ReadinessChecklist title="Inscripciones" ready={readiness.registration.ready} checks={readiness.registration.checks} />
          </div>
        </Panel>

        <LifecyclePanel
          editionId={edition.edition_id}
          states={{
            publication_state: edition.publication_state,
            registration_state: edition.registration_state,
            execution_state: edition.execution_state,
          }}
          readiness={readiness}
          timezone={zone}
          schedule={schedule}
          isAdmin={isAdmin}
        />

        {links.length > 0 ? (
          <Panel title="Secciones de esta edición">
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {links.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    prefetch={false}
                    className="block h-full rounded-control border border-divider p-3 hover:border-ink-60"
                  >
                    <span className="font-semibold text-ink">{link.label}</span>
                    <span className="block text-caption text-ink-60">{link.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </AdminPage>
  );
}
