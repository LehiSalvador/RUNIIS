import type { Metadata } from "next";
import Link from "next/link";
import React, { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarDays } from "lucide-react";
import { AdminPage } from "@/components/admin/admin-page";
import { canAccessSection, describeAssignment, type StaffAssignment } from "@/components/admin/access";
import { DASHBOARD_SAMPLE, editionMetrics, upcomingEditions } from "@/components/admin/dashboard-metrics";
import { ErrorNotice } from "@/components/admin/error-notice";
import { formatCalendarDate } from "@/components/admin/format";
import { Panel, StatTile } from "@/components/admin/panel";
import { ExecutionBadge } from "@/components/admin/status-badges";
import { TilesSkeleton } from "@/components/admin/skeletons";
import { ADMIN_NAV_ITEMS } from "@/components/shell/admin-nav-items";
import { isRouteAvailable } from "@/components/shell/nav-availability";
import { todayInBusinessZone } from "@/lib/client/person-fields";
import { adminListEditions } from "@/lib/server/domain/events/service";
import { requireStaff, settle } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const gate = await requireStaff("/admin", "dashboard");
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;
  const sections = ADMIN_NAV_ITEMS.filter(
    (item) => item.key !== "dashboard" && isRouteAvailable(item.href) && canAccessSection(assignments, item.key),
  );

  return (
    <AdminPage assignments={assignments} title="Dashboard">
      <div className="flex flex-col gap-6">
        {canAccessSection(assignments, "eventos") ? (
          <Suspense fallback={<TilesSkeleton />}>
            <EditionIndicators supabase={supabase} />
          </Suspense>
        ) : null}
        <AccessPanel assignments={assignments} hasSections={sections.length > 0} />
      </div>
    </AdminPage>
  );
}

async function EditionIndicators({ supabase }: { supabase: SupabaseClient }) {
  const result = await settle(adminListEditions(supabase, { limit: DASHBOARD_SAMPLE }), "dashboard.editions");
  if (!result.ok) {
    return <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar los indicadores de ediciones." />;
  }
  const { items, nextCursor } = result.data;
  const today = todayInBusinessZone();
  const metrics = editionMetrics(items, today);
  const suffix = nextCursor !== null ? "+" : "";
  const hint = nextCursor !== null ? `Primeras ${DASHBOARD_SAMPLE} ediciones` : undefined;
  const next = upcomingEditions(items, today);

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores de ediciones">
        <li>
          <StatTile
            label="Próximas ediciones"
            value={`${metrics.upcoming}${suffix}`}
            hint={hint}
            href="/admin/eventos?publication_state=PUBLISHED&execution_state=SCHEDULED"
          />
        </li>
        <li>
          <StatTile label="Inscripciones abiertas" value={`${metrics.registrationOpen}${suffix}`} hint={hint} href="/admin/eventos?registration_state=OPEN" />
        </li>
        <li>
          <StatTile label="Borradores" value={`${metrics.drafts}${suffix}`} hint={hint} href="/admin/eventos?publication_state=DRAFT" />
        </li>
        <li>
          <StatTile label="En curso" value={`${metrics.inProgress}${suffix}`} hint={hint} href="/admin/eventos?execution_state=IN_PROGRESS" />
        </li>
      </ul>

      <Panel title="Próximas carreras" description="Publicadas y programadas, la más cercana primero.">
        {next.length === 0 ? (
          <p className="flex items-center gap-2 text-body-sm text-ink-60">
            <CalendarDays className="size-4" aria-hidden="true" />
            No hay carreras próximas publicadas.
          </p>
        ) : (
          <ul className="divide-y divide-divider">
            {next.map((edition) => (
              <li key={edition.edition_id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link
                    href={`/admin/eventos/${edition.edition_id}`}
                    prefetch={false}
                    className="font-semibold text-ink underline-offset-4 hover:underline"
                  >
                    {edition.name}
                  </Link>
                  <p className="text-caption text-ink-60">
                    {formatCalendarDate(edition.sport_date)} · {edition.city}
                  </p>
                </div>
                <ExecutionBadge value={edition.execution_state} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function AccessPanel({ assignments, hasSections }: { assignments: readonly StaffAssignment[]; hasSections: boolean }) {
  return (
    <Panel title="Tu acceso" description="Lo que tu rol puede hacer en el panel. El servidor lo verifica en cada acción.">
      <ul className="flex flex-wrap gap-2" aria-label="Roles asignados">
        {assignments.map((assignment, index) => (
          <li
            key={`${assignment.role}-${assignment.scope_type}-${assignment.edition_id ?? index}`}
            className="rounded-full border border-control bg-paper-sunken px-3 py-1 text-caption font-semibold text-ink"
          >
            {describeAssignment(assignment)}
          </li>
        ))}
      </ul>
      {!hasSections ? (
        <p className="mt-3 text-body-sm text-ink-60">
          Tu rol no tiene otras pantallas disponibles en el panel por ahora. Si necesitas más acceso, pide a un administrador que lo ajuste.
        </p>
      ) : null}
    </Panel>
  );
}
