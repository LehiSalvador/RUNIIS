import type { Metadata } from "next";
import React, { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AdminNotFound } from "@/components/admin/access-states";
import { AdminPage } from "@/components/admin/admin-page";
import { CursorPager } from "@/components/admin/cursor-pager";
import { DataFreshness } from "@/components/admin/data-freshness";
import { ErrorNotice } from "@/components/admin/error-notice";
import { FilterBar, type FilterField } from "@/components/admin/filter-bar";
import { enumParam, firstParam, nextQuery, withQuery, type RawSearchParams } from "@/components/admin/filters";
import { StatTile } from "@/components/admin/panel";
import { HoldAlert } from "@/components/admin/requests/hold-alert";
import { RequestQueue } from "@/components/admin/requests/request-queue";
import { STATUS_FILTER_OPTIONS, type QueueRequest } from "@/components/admin/requests/request-logic";
import { PanelsSkeleton, TableSkeleton } from "@/components/admin/skeletons";
import { BackToEdition, EditionSectionBody } from "@/app/admin/eventos/_lib/section-body";
import { requireStaff, settle } from "@/app/admin/_lib/session";
import { listTasks } from "@/lib/server/domain/tasks/service";
import { adminListRegistrationRequests } from "@/lib/server/domain/registration/service";
import { REQUEST_STATUSES } from "@/lib/shared/registration";

export const metadata: Metadata = { title: "Solicitudes" };

const TITLE = "Solicitudes";
const PAGE_SIZES = ["10", "25", "50"] as const;

const FILTERS: readonly FilterField[] = [
  { type: "search", name: "search", label: "Buscar", placeholder: "Referencia o nombre del comprador" },
  { type: "select", name: "status", label: "Estado", options: STATUS_FILTER_OPTIONS },
];

export default async function EditionRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ editionId: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { editionId } = await params;
  const raw = await searchParams;
  const current = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) current.set(name, first);
  }
  const path = withQuery(`/admin/eventos/${editionId}/solicitudes`, current.toString());

  const gate = await requireStaff(path, "solicitudes", { editionId });
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
          <PanelsSkeleton count={2} label="Cargando solicitudes" />
        </AdminPage>
      }
    >
      <EditionSectionBody
        supabase={supabase}
        assignments={assignments}
        editionId={editionId}
        section="solicitudes"
        title={TITLE}
        region="requests.edition"
        render={({ editor }) => (
          <div className="flex flex-col gap-4">
            <Suspense fallback={<PanelsSkeleton count={1} label="Cargando la alerta de acaparamiento" />}>
              <AlertRegion supabase={supabase} editionId={editionId} timeZone={editor.edition.timezone} />
            </Suspense>
            <FilterBar fields={FILTERS} />
            <Suspense key={current.toString()} fallback={<TableSkeleton rows={6} columns={5} label="Cargando solicitudes" />}>
              <QueueRegion supabase={supabase} editionId={editionId} params={raw} timeZone={editor.edition.timezone} mode={editor.edition.registration_mode} />
            </Suspense>
          </div>
        )}
      />
    </Suspense>
  );
}

async function AlertRegion({ supabase, editionId, timeZone }: { supabase: SupabaseClient; editionId: string; timeZone: string }) {
  const result = await settle(listTasks(supabase, { edition_id: editionId, category: "ANTI_HOARDING", status: "ACTIVE", limit: 5 }), "requests.alert");
  if (!result.ok) return <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar la alerta de acaparamiento." />;
  const task = result.data.items.find((item) => item.source_rule === "hold-concentration") ?? null;
  return (
    <HoldAlert
      editionId={editionId}
      timeZone={timeZone}
      task={
        task
          ? {
              admin_task_id: task.admin_task_id,
              title: task.title,
              description: task.description,
              detected_at: task.detected_at,
              status: task.status,
              metadata: task.metadata,
            }
          : null
      }
    />
  );
}

async function QueueRegion({
  supabase,
  editionId,
  params,
  timeZone,
  mode,
}: {
  supabase: SupabaseClient;
  editionId: string;
  params: RawSearchParams;
  timeZone: string;
  mode: string;
}) {
  const filters = {
    status: enumParam(params, "status", REQUEST_STATUSES),
    search: firstParam(params, "search")?.slice(0, 100),
  };
  const cursor = firstParam(params, "cursor");
  const limit = enumParam(params, "limit", PAGE_SIZES) ?? "25";
  const result = await settle(adminListRegistrationRequests(supabase, editionId, { ...filters, cursor, limit: Number(limit) }), "requests.queue");
  if (!result.ok) return <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar las solicitudes." />;

  const requests = result.data.items as QueueRequest[];
  const counts = result.data.counts as Partial<Record<string, number>>;
  const canceled = (counts.CANCELED_BY_STAFF ?? 0) + (counts.CANCELED_BY_BUYER ?? 0);

  const query = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...filters, cursor, limit: limit === "25" ? undefined : limit })) if (value) query.set(name, value);
  const nextParams = new URLSearchParams(nextQuery(query, {}));
  if (result.data.nextCursor) nextParams.set("cursor", result.data.nextCursor);
  const base = `/admin/eventos/${editionId}/solicitudes`;
  const statusHref = (status: string) => withQuery(base, new URLSearchParams({ status }).toString());

  return (
    <div className="flex flex-col gap-4">
      {mode === "FREE" ? (
        <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" role="note">
          Esta edición es gratuita: las inscripciones se confirman al instante y no pasan por esta cola.
        </p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen de solicitudes de la edición">
        <li>
          <StatTile label="Pendientes de confirmar" value={counts.PENDING_CONFIRMATION ?? 0} hint="Vigentes, con cupo apartado" href={statusHref("PENDING_CONFIRMATION")} />
        </li>
        <li>
          <StatTile label="Expiradas" value={counts.EXPIRED ?? 0} hint="Sin cupo retenido" href={statusHref("EXPIRED")} />
        </li>
        <li>
          <StatTile label="Confirmadas" value={counts.CONFIRMED ?? 0} href={statusHref("CONFIRMED")} />
        </li>
        <li>
          <StatTile label="Canceladas" value={canceled} hint="Por el comprador o por el staff" />
        </li>
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-60" role="status" aria-live="polite">
          {requests.length === 0 ? "Sin resultados" : `${requests.length} ${requests.length === 1 ? "solicitud" : "solicitudes"} en esta página${result.data.nextCursor ? " (hay más)" : ""}`}
          <span> · Las horas están en la zona de la edición ({timeZone}).</span>
        </p>
        <DataFreshness loadedAt={new Date().toISOString()} timeZone={timeZone} />
      </div>
      <RequestQueue editionId={editionId} timeZone={timeZone} requests={requests} />
      <CursorPager
        shown={requests.length}
        noun={requests.length === 1 ? "solicitud" : "solicitudes"}
        nextHref={result.data.nextCursor ? withQuery(base, nextParams.toString()) : null}
        firstHref={cursor ? withQuery(base, nextQuery(query, {})) : null}
      />
    </div>
  );
}
