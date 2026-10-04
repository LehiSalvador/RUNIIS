import type { Metadata } from "next";
import Link from "next/link";
import React, { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import type { StaffAssignment } from "@/components/admin/access";
import { ErrorNotice } from "@/components/admin/error-notice";
import { EditionForm } from "@/components/admin/events/edition-form";
import { EditionSubnav } from "@/components/admin/events/edition-subnav";
import { EventEditButton } from "@/components/admin/events/event-edit";
import { editionToFormValues } from "@/components/admin/events/form-logic";
import { canManageLifecycle } from "@/components/admin/events/permissions";
import { DefinitionList, Panel } from "@/components/admin/panel";
import { PublicationBadge } from "@/components/admin/status-badges";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { getActiveEventTypes } from "@/lib/server/domain/discovery/service";
import { adminGetEditionEditor, adminGetEvent } from "@/lib/server/domain/events/service";
import { requireStaff, settle } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Datos y fechas" };

function BackToEdition({ editionId }: { editionId: string }) {
  return (
    <Link href={`/admin/eventos/${editionId}`} prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Volver a la edición
    </Link>
  );
}

export default async function EditionConfigurationPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/configuracion`, "eventos", { editionId });
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  if (!z.guid().safeParse(editionId).success) {
    return (
      <AdminPage assignments={assignments} title="Datos y fechas">
        <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
      </AdminPage>
    );
  }

  return (
    <Suspense
      fallback={
        <AdminPage assignments={assignments} title="Datos y fechas" actions={<BackToEdition editionId={editionId} />}>
          <PanelsSkeleton count={3} label="Cargando la configuración" />
        </AdminPage>
      }
    >
      <Configuration supabase={supabase} assignments={assignments} editionId={editionId} />
    </Suspense>
  );
}

async function Configuration({ supabase, assignments, editionId }: { supabase: SupabaseClient; assignments: StaffAssignment[]; editionId: string }) {
  const result = await settle(adminGetEditionEditor(supabase, editionId), "events.configuration");
  if (!result.ok) {
    return (
      <AdminPage assignments={assignments} title="Datos y fechas" actions={<BackToEdition editionId={editionId} />}>
        {result.code === "NOT_FOUND" ? (
          <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
        ) : (
          <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar la edición." />
        )}
      </AdminPage>
    );
  }

  const { edition } = result.data;
  const isAdmin = canManageLifecycle(assignments, editionId);
  // The Event read (P3-L): its name, permanent key, type and status. A failed read only hides that panel; the Edition form stays usable.
  const [eventRead, types] = await Promise.all([
    settle(adminGetEvent(supabase, edition.event_id), "events.configuration.event"),
    isAdmin ? settle(getActiveEventTypes(), "events.configuration.types") : Promise.resolve(null),
  ]);
  const event = eventRead.ok ? eventRead.data : null;
  const eventTypes = types && types.ok ? types.data.map((type) => ({ key: type.key, name: type.name })) : [];

  return (
    <AdminPage assignments={assignments} title={`Datos y fechas · ${edition.name}`} actions={<BackToEdition editionId={editionId} />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <EditionSubnav editionId={editionId} current="configuracion" />
          <div className="flex flex-wrap items-center gap-2">
            <PublicationBadge value={edition.publication_state} />
            {isAdmin && event ? <EventEditButton eventId={event.event_id} name={event.name} eventTypeKey={event.event_type_key} eventTypes={eventTypes} /> : null}
          </div>
        </div>
        {event ? (
          <Panel title="Evento" description="Una edición pertenece a un evento; su clave permanente no cambia.">
            <DefinitionList
              items={[
                { label: "Nombre", value: event.name },
                { label: "Tipo de evento", value: event.event_type_name },
                { label: "Clave permanente", value: <span className="font-mono text-caption">{event.canonical_key}</span> },
                { label: "Estado", value: event.status === "ACTIVE" ? "Activo" : "Archivado" },
                { label: "Ediciones del evento", value: String(event.edition_count) },
              ]}
            />
          </Panel>
        ) : null}
        <EditionForm
          mode="edit"
          editionId={editionId}
          baseline={editionToFormValues(edition)}
          publicationState={edition.publication_state}
          isAdmin={isAdmin}
          updatedAt={edition.updated_at}
        />
      </div>
    </AdminPage>
  );
}
