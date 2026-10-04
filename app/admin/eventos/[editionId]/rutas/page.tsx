import type { Metadata } from "next";
import React, { Suspense } from "react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { BackToEdition, EditionSectionBody } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff } from "@/app/admin/_lib/session";
import { RoutesRegion } from "@/app/admin/eventos/[editionId]/rutas/routes-region";

export const metadata: Metadata = { title: "Rutas" };

const TITLE = "Rutas";

export default async function EditionRoutesPage({
  params,
  searchParams,
}: {
  params: Promise<{ editionId: string }>;
  searchParams: Promise<{ route?: string | string[]; revision?: string | string[] }>;
}) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/rutas`, "eventos", { editionId });
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

  const query = await searchParams;
  const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const routeParam = single(query.route);
  const revisionParam = single(query.revision);

  return (
    <Suspense
      fallback={
        <AdminPage assignments={assignments} title={TITLE} actions={<BackToEdition editionId={editionId} />}>
          <PanelsSkeleton count={2} label="Cargando rutas" />
        </AdminPage>
      }
    >
      <EditionSectionBody
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        section="rutas"
        title={TITLE}
        region="events.routes"
        render={({ editor }) => (
          <Suspense fallback={<PanelsSkeleton count={2} label="Cargando rutas" />}>
            <RoutesRegion supabase={supabase} editionId={editionId} editor={editor} routeParam={routeParam} revisionParam={revisionParam} />
          </Suspense>
        )}
      />
    </Suspense>
  );
}
