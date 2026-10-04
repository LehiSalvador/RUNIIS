import type { Metadata } from "next";
import React, { Suspense } from "react";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { ClosureDesk } from "@/components/admin/closure/closure-desk";
import { ClosureFrame } from "@/components/admin/closure/edition-frame";
import { isGlobalAdmin } from "@/components/admin/events/permissions";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { BackToEdition } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Cierre" };

const TITLE = "Cierre";

/**
 * Closure of one Edition (P3-I, Master sections 96-99, T12 J5). The page is an ADMIN surface (NAV_ACCESS.cierre); closing and reopening the
 * Edition are GLOBAL ADMIN only (P3SECA-05), so an Edition-scoped administrator reads the readiness and the credit summary but is never offered the
 * actions. Hiding is cosmetic: the API and the database authorise every command again.
 */
export default async function EditionClosurePage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const gate = await requireStaff(`/admin/eventos/${editionId}/cierre`, "cierre", { editionId });
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

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
          <PanelsSkeleton count={3} label="Cargando el cierre" />
        </AdminPage>
      }
    >
      <ClosureFrame
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        title={TITLE}
        section="cierre"
        region="closure.edition"
        render={(edition) => <ClosureDesk editionId={editionId} timeZone={edition.timezone} isGlobalAdmin={isGlobalAdmin(assignments)} />}
      />
    </Suspense>
  );
}
