import type { Metadata } from "next";
import React, { Suspense } from "react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { LocationsManager } from "@/components/admin/edition-config/locations-manager";
import type { LocationRow } from "@/components/admin/edition-config/location-logic";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { BackToEdition, EditionSectionBody } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Ubicaciones" };

const TITLE = "Ubicaciones";

export default async function EditionLocationsPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/ubicaciones`, "eventos", { editionId });
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
          <PanelsSkeleton count={2} label="Cargando ubicaciones" />
        </AdminPage>
      }
    >
      <EditionSectionBody
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        section="ubicaciones"
        title={TITLE}
        region="events.locations"
        render={({ editor }) => (
          <LocationsManager
            editionId={editionId}
            locations={[...editor.locations].sort((a, b) => a.sort_order - b.sort_order) as LocationRow[]}
            defaults={{ city: editor.edition.city, state_region: editor.edition.state_region, country_code: editor.edition.country_code }}
          />
        )}
      />
    </Suspense>
  );
}
