import type { Metadata } from "next";
import Link from "next/link";
import React, { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, ScanLine } from "lucide-react";
import { z } from "zod";
import { AdminForbidden, AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { hasRoleForEdition } from "@/components/admin/access";
import { DataFreshness } from "@/components/admin/data-freshness";
import { ErrorNotice } from "@/components/admin/error-notice";
import { EditionSubnav } from "@/components/admin/events/edition-subnav";
import { GuardianDesk, type GuardianRow } from "@/components/admin/raceday/guardian-desk";
import { TableSkeleton } from "@/components/admin/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { requireStaff, settle } from "@/app/admin/_lib/session";
import { adminGetEditionEditor } from "@/lib/server/domain/events/service";
import { listGuardianVerifications } from "@/lib/server/domain/raceday/service";

export const metadata: Metadata = { title: "Mesa de tutores" };

const TITLE = "Mesa de tutores";
/** The roles the guardian API authorises (GUARDIAN_VERIFY). */
const DESK_ROLES = ["ADMIN", "OPERATOR", "CHECKIN"] as const;
const CONFIG_ROLES = ["ADMIN", "OPERATOR"] as const;

export default async function GuardianDeskPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  // The section key only supplies the base "any staff role" check for this Edition; the desk's own role list follows. A CHECKIN
  // member has no Eventos section, so the page cannot be gated by a nav section.
  const gate = await requireStaff(`/admin/eventos/${editionId}/tutores`, "dashboard", { editionId });
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  if (!hasRoleForEdition(assignments, DESK_ROLES, editionId)) {
    return (
      <AdminPage assignments={assignments} title="Acceso restringido">
        <AdminForbidden staff />
      </AdminPage>
    );
  }

  if (!z.guid().safeParse(editionId).success) {
    return (
      <AdminPage assignments={assignments} title={TITLE}>
        <AdminNotFound backHref="/admin" backLabel="Volver al panel" />
      </AdminPage>
    );
  }

  const configurator = hasRoleForEdition(assignments, CONFIG_ROLES, editionId);
  return (
    <AdminPage
      assignments={assignments}
      title={TITLE}
      actions={
        <Link href="/scanner" prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          <ScanLine className="size-4" aria-hidden="true" />
          Ir al escáner
        </Link>
      }
    >
      <div className="flex flex-col gap-4">
        {configurator ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/admin/eventos/${editionId}`} prefetch={false} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Volver a la edición
            </Link>
            <EditionSubnav editionId={editionId} current="tutores" />
          </div>
        ) : null}
        <Suspense fallback={<TableSkeleton rows={5} columns={4} label="Cargando verificaciones" />}>
          <DeskRegion supabase={supabase} editionId={editionId} configurator={configurator} />
        </Suspense>
      </div>
    </AdminPage>
  );
}

async function DeskRegion({ supabase, editionId, configurator }: { supabase: SupabaseClient; editionId: string; configurator: boolean }) {
  const [list, editor] = await Promise.all([
    settle(listGuardianVerifications(supabase, editionId), "guardian.list"),
    // The Edition's zone is only readable with event-configuration access; CHECKIN sees times in the platform default zone.
    configurator ? settle(adminGetEditionEditor(supabase, editionId), "guardian.edition") : Promise.resolve(null),
  ]);
  if (!list.ok) {
    if (list.code === "NOT_FOUND") return <AdminNotFound backHref="/admin" backLabel="Volver al panel" />;
    return <ErrorNotice code={list.code} requestId={list.requestId} title="No pudimos cargar las verificaciones." />;
  }
  const rows: GuardianRow[] = list.data.map((item) => ({
    guardian_event_verification_id: item.guardian_event_verification_id,
    status: item.status,
    created_at: item.created_at,
    participant: {
      registration_id: item.participant.registration_id,
      registration_number: item.participant.registration_number,
      display_name: item.participant.display_name,
      modality: { name: item.participant.modality.name },
      category: item.participant.category ? { name: item.participant.category.name } : null,
    },
  }));
  const timezone = editor && editor.ok ? editor.data.edition.timezone : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <DataFreshness loadedAt={new Date().toISOString()} timeZone={timezone ?? undefined} />
      </div>
      <GuardianDesk rows={rows} timezone={timezone} />
    </div>
  );
}
