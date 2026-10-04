"use client";

import React from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatDateTime } from "@/components/admin/format";
import { Panel } from "@/components/admin/panel";
import { RevisionStatusBadge, SOURCE_LABEL } from "@/components/admin/routes/revision-badges";
import { formatKm, type RevisionSummary } from "@/components/admin/routes/route-geometry";

/** History of a Route: newest first, one row per revision; "Abrir" shows it in the editor below. A published revision is never edited, only copied. */
export function RevisionsPanel({
  routeId,
  revisions,
  currentId,
  timeZone,
}: {
  routeId: string;
  revisions: readonly RevisionSummary[];
  currentId: string | null;
  timeZone: string;
}) {
  const rows = React.useMemo(() => [...revisions].sort((a, b) => b.revision - a.revision), [revisions]);
  const columns = React.useMemo<DataTableColumn<RevisionSummary>[]>(
    () => [
      {
        key: "revision",
        header: "Revisión",
        priority: 1,
        render: (row) => (
          <Link
            href={`?route=${routeId}&revision=${row.route_revision_id}`}
            prefetch={false}
            scroll={false}
            aria-current={row.route_revision_id === currentId ? "true" : undefined}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            Revisión {row.revision}
            {row.route_revision_id === currentId ? <span className="sr-only"> (abierta)</span> : null}
          </Link>
        ),
      },
      { key: "status", header: "Estado", priority: 2, render: (row) => <RevisionStatusBadge value={row.status} /> },
      { key: "distance", header: "Distancia calculada", priority: 3, align: "right", render: (row) => formatKm(row.computed_distance_m) },
      { key: "source", header: "Origen", priority: 4, render: (row) => SOURCE_LABEL[row.source] },
      { key: "created", header: "Creada", priority: 5, render: (row) => formatDateTime(row.created_at, timeZone) },
      { key: "published", header: "Publicada", priority: 6, render: (row) => formatDateTime(row.published_at, timeZone) },
    ],
    [routeId, currentId, timeZone],
  );

  return (
    <Panel title="Revisiones" description="Cada cambio publicado es una revisión nueva; la publicada se conserva como Reemplazada.">
      <div data-testid="revisions-panel">
        <DataTable
          caption="Revisiones de la ruta"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.route_revision_id}
          getRowLabel={(row) => `Revisión ${row.revision}`}
          keepColumnsBelowLg={3}
          keepColumnsBelowMd={2}
          emptyState={{
            icon: History,
            title: "Esta ruta aún no tiene revisiones",
            description: "Importa un GPX o dibuja el recorrido para crear la primera.",
            headingLevel: "h3",
          }}
        />
      </div>
    </Panel>
  );
}
