import type { Metadata } from "next";
import React, { Suspense } from "react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { ContentManager } from "@/components/admin/edition-config/content-manager";
import type { ContentRow } from "@/components/admin/edition-config/content-logic";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { BackToEdition, EditionSectionBody } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Contenido" };

const TITLE = "Contenido";

export default async function EditionContentPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/contenido`, "eventos", { editionId });
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
          <PanelsSkeleton count={2} label="Cargando el contenido" />
        </AdminPage>
      }
    >
      <EditionSectionBody
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        section="contenido"
        title={TITLE}
        region="events.content"
        render={({ editor }) => (
          <ContentManager
            editionId={editionId}
            blocks={editor.content_blocks as ContentRow[]}
            modalities={editor.modalities.filter((modality) => modality.status !== "CANCELED").map((modality) => ({ id: modality.modality_id, name: modality.name }))}
            descriptionReady={editor.readiness.publication.checks.find((check) => check.code === "DESCRIPTION_PRESENT")?.ok === true}
          />
        )}
      />
    </Suspense>
  );
}
