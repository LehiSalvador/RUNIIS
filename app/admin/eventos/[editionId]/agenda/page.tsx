import type { Metadata } from "next";
import React, { Suspense } from "react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { AgendaManager } from "@/components/admin/edition-config/agenda-manager";
import type { AgendaRow } from "@/components/admin/edition-config/agenda-logic";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { BackToEdition, EditionSectionBody } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Agenda" };

const TITLE = "Agenda";

export default async function EditionAgendaPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/agenda`, "eventos", { editionId });
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  // A malformed id can never name an Edition; answer "not found" without a database round trip.
  if (!z.guid().safeParse(editionId).success) {
    return (
      <AdminPage assignments={assignments} title={TITLE}>
        <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
      </AdminPage>
    );
  }

  return (
    <Suspense
      fallback={
        <AdminPage assignments={assignments} title={TITLE} actions={<BackToEdition editionId={editionId} />}>
          <PanelsSkeleton count={2} label="Cargando la agenda" />
        </AdminPage>
      }
    >
      <EditionSectionBody
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        section="agenda"
        title={TITLE}
        region="events.agenda"
        render={({ editor }) => (
          <AgendaManager
            editionId={editionId}
            timezone={editor.edition.timezone}
            raceDate={editor.edition.schedule?.local_date ?? null}
            items={editor.agenda as AgendaRow[]}
            modalities={editor.modalities.filter((modality) => modality.status !== "CANCELED").map((modality) => ({ id: modality.modality_id, name: modality.name }))}
            locations={editor.locations.map((location) => ({ id: location.edition_location_id, name: location.name }))}
          />
        )}
      />
    </Suspense>
  );
}
