"use client";

import React from "react";
import Link from "next/link";
import { CalendarX, Eye, ExternalLink } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { DetailDrawer } from "@/components/admin/detail-drawer";
import { DefinitionList } from "@/components/admin/panel";
import { ExecutionBadge, PublicationBadge, RegistrationBadge } from "@/components/admin/status-badges";
import { formatCalendarDate } from "@/components/admin/format";

/** One row of GET /api/v1/admin/events (admin_list_editions), the fields the list needs. */
export type EditionRow = {
  edition_id: string;
  event_name: string;
  name: string;
  slug: string;
  publication_state: string;
  registration_state: string;
  execution_state: string;
  closure_state: string;
  city: string;
  country_code: string;
  sport_date: string | null;
  created_at: string;
};

/**
 * Client wrapper for the Events list. DataTable columns carry render functions, which cannot cross the
 * server -> client boundary, so each list screen owns a small client wrapper like this one and passes plain
 * rows from its server page. Row actions: "Abrir" (full page, the primary path) and "Vista rápida" (the
 * DetailDrawer quick-look pattern).
 */
export function EditionsTable({
  rows,
  emptyTitle,
  emptyDescription,
}: {
  rows: EditionRow[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [peek, setPeek] = React.useState<EditionRow | null>(null);

  const columns = React.useMemo<DataTableColumn<EditionRow>[]>(
    () => [
      {
        key: "name",
        header: "Edición",
        priority: 1,
        render: (row) => (
          <div className="min-w-0">
            <Link
              href={`/admin/eventos/${row.edition_id}`}
              prefetch={false}
              className="font-semibold text-ink underline-offset-4 hover:underline"
            >
              {row.name}
            </Link>
            <p className="truncate text-caption text-ink-60">{row.event_name}</p>
          </div>
        ),
      },
      { key: "publication", header: "Publicación", priority: 3, render: (row) => <PublicationBadge value={row.publication_state} /> },
      { key: "date", header: "Fecha", priority: 2, render: (row) => formatCalendarDate(row.sport_date) },
      { key: "registration", header: "Inscripciones", priority: 4, render: (row) => <RegistrationBadge value={row.registration_state} /> },
      { key: "execution", header: "Ejecución", priority: 5, render: (row) => <ExecutionBadge value={row.execution_state} /> },
      { key: "city", header: "Ciudad", priority: 6, render: (row) => row.city },
    ],
    [],
  );

  return (
    <>
      <DataTable
        caption="Ediciones"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.edition_id}
        getRowLabel={(row) => row.name}
        keepColumnsBelowLg={4}
        keepColumnsBelowMd={2}
        emptyState={{
          icon: CalendarX,
          title: emptyTitle ?? "No hay ediciones con estos filtros",
          description: emptyDescription ?? "Cambia o limpia los filtros para ver más resultados.",
          headingLevel: "h2",
        }}
        rowActions={(row) => (
          <div className="flex flex-wrap justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPeek(row)} aria-label={`Vista rápida de ${row.name}`}>
              <Eye className="size-4" aria-hidden="true" />
              Vista rápida
            </Button>
            <Link
              href={`/admin/eventos/${row.edition_id}`}
              prefetch={false}
              aria-label={`Abrir ${row.name}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Abrir
            </Link>
          </div>
        )}
      />

      <DetailDrawer
        open={peek !== null}
        onOpenChange={(open) => !open && setPeek(null)}
        title={peek?.name ?? "Edición"}
        description={peek?.event_name}
        footer={
          peek ? (
            <Link
              href={`/admin/eventos/${peek.edition_id}`}
              prefetch={false}
              className={buttonVariants({ variant: "primary" })}
              onClick={() => setPeek(null)}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Abrir edición
            </Link>
          ) : undefined
        }
      >
        {peek ? (
          <DefinitionList
            columns={1}
            items={[
              { label: "Publicación", value: <PublicationBadge value={peek.publication_state} /> },
              { label: "Inscripciones", value: <RegistrationBadge value={peek.registration_state} /> },
              { label: "Ejecución", value: <ExecutionBadge value={peek.execution_state} /> },
              { label: "Fecha de la carrera", value: formatCalendarDate(peek.sport_date) },
              { label: "Ciudad", value: `${peek.city}, ${peek.country_code}` },
              { label: "Enlace público", value: <span className="font-mono text-caption">/eventos/{peek.slug}</span> },
            ]}
          />
        ) : null}
      </DetailDrawer>
    </>
  );
}
