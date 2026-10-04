import Link from "next/link";
import React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft } from "lucide-react";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import type { StaffAssignment } from "@/components/admin/access";
import { ErrorNotice } from "@/components/admin/error-notice";
import { EditionSubnav, type EditionSection } from "@/components/admin/events/edition-subnav";
import { PublicationBadge } from "@/components/admin/status-badges";
import { buttonVariants } from "@/components/ui/button";
import { adminGetEditionEditor } from "@/lib/server/domain/events/service";
import { settle } from "@/app/admin/_lib/session";

export type EditorData = Awaited<ReturnType<typeof adminGetEditionEditor>>;

export function BackToEdition({ editionId }: { editionId: string }) {
  return (
    <Link href={`/admin/eventos/${editionId}`} prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      Volver a la edición
    </Link>
  );
}

/**
 * Body of one Edition configuration page (P3-E2): loads the editor projection for the Edition, renders the not-found / error states, and
 * wraps the section in the shared chrome (sub-navigation, publication badge, frozen-edition note). The PAGE has already awaited
 * `requireStaff` and shown its refusal; this runs inside the page's <Suspense>, so the data region streams.
 */
export async function EditionSectionBody({
  supabase,
  assignments,
  editionId,
  section,
  title,
  region,
  render,
}: {
  supabase: SupabaseClient;
  assignments: StaffAssignment[];
  editionId: string;
  section: EditionSection;
  title: string;
  region: string;
  render: (context: { editor: EditorData; assignments: StaffAssignment[] }) => React.ReactNode;
}) {
  const result = await settle(adminGetEditionEditor(supabase, editionId), region);
  if (!result.ok) {
    return (
      <AdminPage assignments={assignments} title={title} actions={<BackToEdition editionId={editionId} />}>
        {result.code === "NOT_FOUND" ? (
          <AdminNotFound backHref="/admin/eventos" backLabel="Volver a eventos" />
        ) : (
          <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar la edición." />
        )}
      </AdminPage>
    );
  }

  const { edition } = result.data;
  const frozen = edition.execution_state === "FINISHED" || edition.execution_state === "CANCELED";
  return (
    <AdminPage assignments={assignments} title={`${title} · ${edition.name}`} actions={<BackToEdition editionId={editionId} />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <EditionSubnav editionId={editionId} current={section} />
          <PublicationBadge value={edition.publication_state} />
        </div>
        {frozen ? (
          <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" role="note">
            La edición ya terminó o se canceló: algunas configuraciones están congeladas y el servidor rechazará esos cambios.
          </p>
        ) : null}
        {render({ editor: result.data, assignments })}
      </div>
    </AdminPage>
  );
}
