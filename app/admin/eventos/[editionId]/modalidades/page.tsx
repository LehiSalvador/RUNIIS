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
import { CategoriesManager } from "@/components/admin/events/categories-manager";
import { EditionSubnav } from "@/components/admin/events/edition-subnav";
import { ModalitiesManager } from "@/components/admin/events/modalities-manager";
import { PublicationBadge } from "@/components/admin/status-badges";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { adminGetEditionEditor } from "@/lib/server/domain/events/service";
import { requireStaff, settle } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Modalidades y precios" };

function BackToEdition({ editionId }: { editionId: string }) {
  return (
    <Link href={`/admin/eventos/${editionId}`} prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Volver a la edición
    </Link>
  );
}

export default async function EditionModalitiesPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/modalidades`, "eventos", { editionId });
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  if (!z.guid().safeParse(editionId).success) {
    return (
      <AdminPage assignments={assignments} title="Modalidades y precios">
        <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
      </AdminPage>
    );
  }

  return (
    <Suspense
      fallback={
        <AdminPage assignments={assignments} title="Modalidades y precios" actions={<BackToEdition editionId={editionId} />}>
          <PanelsSkeleton count={3} label="Cargando modalidades" />
        </AdminPage>
      }
    >
      <Modalities supabase={supabase} assignments={assignments} editionId={editionId} />
    </Suspense>
  );
}

async function Modalities({ supabase, assignments, editionId }: { supabase: SupabaseClient; assignments: StaffAssignment[]; editionId: string }) {
  const result = await settle(adminGetEditionEditor(supabase, editionId), "events.modalities");
  if (!result.ok) {
    return (
      <AdminPage assignments={assignments} title="Modalidades y precios" actions={<BackToEdition editionId={editionId} />}>
        {result.code === "NOT_FOUND" ? (
          <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
        ) : (
          <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar la edición." />
        )}
      </AdminPage>
    );
  }

  const { edition, availability, modalities, categories } = result.data;
  const frozen = edition.execution_state === "FINISHED" || edition.execution_state === "CANCELED";

  return (
    <AdminPage assignments={assignments} title={`Modalidades y precios · ${edition.name}`} actions={<BackToEdition editionId={editionId} />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <EditionSubnav editionId={editionId} current="modalidades" />
          <PublicationBadge value={edition.publication_state} />
        </div>
        {frozen ? (
          <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" role="note">
            La edición ya terminó o se canceló: la configuración estructural (modalidades, precios, capacidad) está congelada y el servidor rechazará los cambios.
          </p>
        ) : null}
        <ModalitiesManager
          editionId={editionId}
          timezone={edition.timezone}
          publicationState={edition.publication_state}
          globalCapacity={edition.global_capacity}
          availability={availability}
          modalities={modalities}
        />
        <CategoriesManager
          editionId={editionId}
          categories={categories}
          modalities={modalities.map((modality) => ({ modality_id: modality.modality_id, name: modality.name }))}
        />
      </div>
    </AdminPage>
  );
}
