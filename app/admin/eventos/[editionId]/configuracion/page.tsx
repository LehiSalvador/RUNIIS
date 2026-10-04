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
import { PublicationBadge } from "@/components/admin/status-badges";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { adminGetEditionEditor, adminListEditions } from "@/lib/server/domain/events/service";
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
  // The Event's own name is not in the editor projection: it is read from the Editions list (same Event).
  const siblings = await settle(adminListEditions(supabase, { event_id: edition.event_id, limit: 1 }), "events.configuration.event");
  const eventName = siblings.ok ? (siblings.data.items[0]?.event_name ?? null) : null;

  return (
    <AdminPage assignments={assignments} title={`Datos y fechas · ${edition.name}`} actions={<BackToEdition editionId={editionId} />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <EditionSubnav editionId={editionId} current="configuracion" />
          <div className="flex flex-wrap items-center gap-2">
            <PublicationBadge value={edition.publication_state} />
            {isAdmin && eventName ? <EventEditButton eventId={edition.event_id} name={eventName} /> : null}
          </div>
        </div>
        {eventName ? (
          <p className="text-body-sm text-ink-60">
            Evento: <strong className="text-ink">{eventName}</strong>
          </p>
        ) : null}
        <EditionForm
          mode="edit"
          editionId={editionId}
          baseline={editionToFormValues(edition)}
          publicationState={edition.publication_state}
          isAdmin={isAdmin}
          resetKey={`${edition.updated_at}|${edition.schedule?.edition_schedule_revision_id ?? "none"}`}
        />
      </div>
    </AdminPage>
  );
}
