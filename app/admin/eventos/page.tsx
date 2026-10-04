import type { Metadata } from "next";
import React, { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AdminPage } from "@/components/admin/admin-page";
import { isGlobalAdmin } from "@/components/admin/events/permissions";
import { buttonVariants } from "@/components/ui/button";
import { CursorPager } from "@/components/admin/cursor-pager";
import { DataFreshness } from "@/components/admin/data-freshness";
import { EditionsTable } from "@/components/admin/editions-table";
import { ErrorNotice } from "@/components/admin/error-notice";
import { FilterBar, type FilterField } from "@/components/admin/filter-bar";
import { enumParam, firstParam, nextQuery, withQuery, type RawSearchParams } from "@/components/admin/filters";
import { TableSkeleton } from "@/components/admin/skeletons";
import { EXECUTION_STATES, PUBLICATION_STATES, REGISTRATION_STATES } from "@/components/admin/status-badges";
import { adminListEditions } from "@/lib/server/domain/events/service";
import { requireStaff, settle } from "@/app/admin/_lib/session";

export const metadata: Metadata = { title: "Eventos" };

// Page size is fixed at 20 for operators; the URL may narrow/widen it within an allow-list (also what lets the
// e2e suite exercise paging against the small local seed).
const PAGE_SIZES = ["5", "10", "20", "50"] as const;
const PUBLICATION = ["DRAFT", "PUBLISHED", "HIDDEN"] as const;
const REGISTRATION = ["NOT_OPEN", "OPEN", "PAUSED", "CLOSED"] as const;
const EXECUTION = ["SCHEDULED", "POSTPONED", "IN_PROGRESS", "FINISHED", "CANCELED"] as const;

const toOptions = (table: Record<string, { label: string }>, keys: readonly string[]) =>
  keys.map((key) => ({ value: key, label: table[key].label }));

const FILTERS: readonly FilterField[] = [
  { type: "search", name: "search", label: "Buscar", placeholder: "Nombre de la edición o del evento" },
  { type: "select", name: "publication_state", label: "Publicación", options: toOptions(PUBLICATION_STATES, PUBLICATION) },
  { type: "select", name: "registration_state", label: "Inscripciones", options: toOptions(REGISTRATION_STATES, REGISTRATION) },
  { type: "select", name: "execution_state", label: "Ejecución", options: toOptions(EXECUTION_STATES, EXECUTION) },
];

export default async function AdminEventsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = await searchParams;
  const current = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) current.set(name, first);
  }
  const path = withQuery("/admin/eventos", current.toString());

  const gate = await requireStaff(path, "eventos");
  if (!gate.allowed) return gate.forbidden;
  const { supabase, assignments } = gate.staff;

  return (
    <AdminPage
      assignments={assignments}
      title="Eventos"
      actions={
        isGlobalAdmin(assignments) ? (
          <Link href="/admin/eventos/nuevo" prefetch={false} className={buttonVariants({ size: "sm" })}>
            <Plus className="size-4" aria-hidden="true" />
            Nueva edición
          </Link>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <FilterBar fields={FILTERS} />
        <Suspense key={current.toString()} fallback={<TableSkeleton rows={8} columns={6} label="Cargando ediciones" />}>
          <EditionsResults supabase={supabase} params={params} />
        </Suspense>
      </div>
    </AdminPage>
  );
}

async function EditionsResults({ supabase, params }: { supabase: SupabaseClient; params: RawSearchParams }) {
  const filters = {
    search: firstParam(params, "search")?.slice(0, 100),
    publication_state: enumParam(params, "publication_state", PUBLICATION),
    registration_state: enumParam(params, "registration_state", REGISTRATION),
    execution_state: enumParam(params, "execution_state", EXECUTION),
  };
  const cursor = firstParam(params, "cursor");
  const pageSize = enumParam(params, "limit", PAGE_SIZES);
  const result = await settle(adminListEditions(supabase, { ...filters, cursor, limit: Number(pageSize ?? "20") }), "events.list");
  if (!result.ok) {
    return <ErrorNotice code={result.code} requestId={result.requestId} title="No pudimos cargar las ediciones." />;
  }

  const { items, nextCursor } = result.data;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...filters, cursor, limit: pageSize })) if (value) query.set(name, value);
  // nextQuery drops "cursor" by design (a changed filter restarts paging), so the next-page link sets it afterwards.
  const nextParams = new URLSearchParams(nextQuery(query, {}));
  if (nextCursor) nextParams.set("cursor", nextCursor);
  const firstHref = cursor ? withQuery("/admin/eventos", nextQuery(query, {})) : null;
  const hasFilters = Boolean(filters.search || filters.publication_state || filters.registration_state || filters.execution_state);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-60" role="status" aria-live="polite">
          {items.length === 0
            ? "Sin resultados"
            : `${items.length} ${items.length === 1 ? "edición" : "ediciones"} en esta página${nextCursor ? " (hay más)" : ""}`}
        </p>
        <DataFreshness loadedAt={new Date().toISOString()} />
      </div>
      <EditionsTable
        rows={items}
        emptyTitle={hasFilters ? undefined : "Todavía no hay ediciones"}
        emptyDescription={hasFilters ? undefined : "Las que se creen aparecerán aquí."}
      />
      <CursorPager
        shown={items.length}
        noun={items.length === 1 ? "edición" : "ediciones"}
        nextHref={nextCursor ? withQuery("/admin/eventos", nextParams.toString()) : null}
        firstHref={firstHref}
      />
    </div>
  );
}
