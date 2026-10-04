import React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { hasRoleForEdition, type StaffAssignment } from "@/components/admin/access";
import { ErrorNotice } from "@/components/admin/error-notice";
import { EditionSubnav, type EditionSection } from "@/components/admin/events/edition-subnav";
import { CLOSURE_LABEL, ExecutionBadge } from "@/components/admin/status-badges";
import { BackToEdition } from "@/app/admin/eventos/_lib/section-body";
import { settle } from "@/app/admin/_lib/session";
import { adminGetEditionEditor } from "@/lib/server/domain/events/service";

export type FrameEdition = { name: string; timezone: string; executionState: string; closureState: string };

/**
 * Chrome of the attendance and closure pages: loads the Edition (name, timezone, execution and closure state) and renders the not-found / error
 * states and the sub-navigation around the client desk. The PAGE has already awaited `requireStaff`; this runs inside its <Suspense>. The desk itself
 * reads the attendance workspace from the browser (a writing call: never prefetched, see components/admin/closure/closure-api.ts).
 */
export async function ClosureFrame({
  supabase,
  assignments,
  editionId,
  title,
  section,
  region,
  render,
}: {
  supabase: SupabaseClient;
  assignments: StaffAssignment[];
  editionId: string;
  title: string;
  section: Extract<EditionSection, "asistencia" | "cierre">;
  region: string;
  render: (edition: FrameEdition) => React.ReactNode;
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
  return (
    <AdminPage assignments={assignments} title={`${title} · ${edition.name}`} actions={<BackToEdition editionId={editionId} />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <EditionSubnav editionId={editionId} current={section} showClosure={hasRoleForEdition(assignments, ["ADMIN"], editionId)} />
          <div className="flex flex-wrap items-center gap-2">
            <ExecutionBadge value={edition.execution_state} />
            <span className="text-caption text-ink-60" data-testid="edition-closure-state">
              Cierre: {CLOSURE_LABEL[edition.closure_state] ?? edition.closure_state}
            </span>
          </div>
        </div>
        {render({ name: edition.name, timezone: edition.timezone, executionState: edition.execution_state, closureState: edition.closure_state })}
      </div>
    </AdminPage>
  );
}
