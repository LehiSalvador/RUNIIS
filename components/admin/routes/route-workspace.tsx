"use client";

import React from "react";
import Link from "next/link";
import { Copy, FileUp, Plus, Route as RouteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/client/cn";
import { ErrorNotice } from "@/components/admin/error-notice";
import { Panel } from "@/components/admin/panel";
import { GpxImportDialog } from "@/components/admin/routes/gpx-import-dialog";
import { RevisionsPanel } from "@/components/admin/routes/revisions-panel";
import { RevisionStatusBadge, RouteStatusBadge } from "@/components/admin/routes/revision-badges";
import { RevisionWorkbench } from "@/components/admin/routes/revision-workbench";
import { RouteFormDialog } from "@/components/admin/routes/route-form-dialog";
import { formatKm, type ModalityOption, type RevisionFull, type RouteDetail, type RouteRow } from "@/components/admin/routes/route-geometry";
import type { ApiFailureCode } from "@/lib/client/api";

type Dialog = "create" | "duplicate" | "import" | null;

/**
 * The Route area of an Edition (P3-F): pick or create a Route, import a GPX, see its revisions and work on one of them. The server page
 * resolves what is selected (`?route=` and `?revision=` in the URL, so every state is a link that can be shared and reloaded) and passes
 * plain data; every write goes through the admin API and the page re-renders from the server afterwards.
 */
export function RouteWorkspace({
  editionId,
  routes,
  selected,
  revision,
  revisionError,
  modalities,
  timeZone,
}: {
  editionId: string;
  routes: readonly RouteRow[];
  selected: RouteDetail | null;
  revision: RevisionFull | null;
  revisionError: { code: ApiFailureCode; requestId: string } | null;
  modalities: readonly ModalityOption[];
  timeZone: string;
}) {
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const modalityName = (id: string) => modalities.find((modality) => modality.modality_id === id)?.name ?? "Modalidad";
  const selectedRoute = selected ? routes.find((route) => route.route_id === selected.route_id) ?? selected : null;

  return (
    <div className="flex flex-col gap-4" data-testid="route-workspace">
      <Panel
        title="Rutas de la edición"
        description="Una ruta recorre una o más modalidades de esta edición. Elige una para ver sus revisiones o crea una nueva."
        actions={
          <Button type="button" size="sm" onClick={() => setDialog("create")}>
            <Plus className="size-4" aria-hidden="true" />
            Nueva ruta
          </Button>
        }
      >
        {routes.length === 0 ? (
          <EmptyState
            icon={RouteIcon}
            title="Esta edición aún no tiene rutas"
            description="Crea la primera, elige las modalidades que la recorren y luego importa un GPX o dibuja el recorrido."
            headingLevel="h3"
            action={
              <Button type="button" onClick={() => setDialog("create")}>
                <Plus className="size-4" aria-hidden="true" />
                Crear la primera ruta
              </Button>
            }
          />
        ) : (
          <nav aria-label="Rutas de la edición">
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="route-list">
              {routes.map((route) => {
                const active = route.route_id === selected?.route_id;
                return (
                  <li key={route.route_id}>
                    <Link
                      href={`?route=${route.route_id}`}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      data-route-name={route.name}
                      className={cn(
                        "flex min-h-11 flex-col gap-1 rounded-control border p-3 transition-colors duration-fast ease-standard",
                        active ? "border-ink bg-lime-soft" : "border-control bg-paper-raised hover:border-ink-60",
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-2 text-body-sm font-semibold text-ink">
                        {route.name}
                        <RouteStatusBadge value={route.status} />
                      </span>
                      <span className="text-caption text-ink-60">{route.modality_ids.map(modalityName).join(", ") || "Sin modalidades"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </Panel>

      {selected ? (
        <>
          <Panel
            title={selected.name}
            description={`Modalidades: ${selected.modality_ids.map(modalityName).join(", ") || "ninguna"}`}
            headingLevel="h2"
            actions={
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog("import")}>
                  <FileUp className="size-4" aria-hidden="true" />
                  Importar GPX
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog("duplicate")} disabled={selected.revisions.length === 0} title={selected.revisions.length === 0 ? "No hay una revisión que copiar" : undefined}>
                  <Copy className="size-4" aria-hidden="true" />
                  Duplicar ruta
                </Button>
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-ink-80" data-testid="route-header">
              <RouteStatusBadge value={selected.status} />
              <span>
                Revisión vigente:{" "}
                {selected.active_revision_id ? (
                  <span className="inline-flex items-center gap-1.5 align-middle">
                    {`Revisión ${selected.revisions.find((entry) => entry.route_revision_id === selected.active_revision_id)?.revision ?? "?"}`}
                    <RevisionStatusBadge value="PUBLISHED" />
                  </span>
                ) : (
                  "ninguna publicada"
                )}
              </span>
              <span>
                Distancia oficial:{" "}
                {selected.modality_ids
                  .map((id) => modalities.find((modality) => modality.modality_id === id))
                  .filter((modality): modality is ModalityOption => Boolean(modality))
                  .map((modality) => `${modality.name} ${modality.official_distance_m ? formatKm(modality.official_distance_m, 1) : "sin definir"}`)
                  .join(" · ") || "—"}
              </span>
            </div>
          </Panel>

          <RevisionsPanel routeId={selected.route_id} revisions={selected.revisions} currentId={revision?.route_revision_id ?? null} timeZone={timeZone} />

          {revisionError ? (
            <ErrorNotice code={revisionError.code} requestId={revisionError.requestId} title="No pudimos cargar la revisión." />
          ) : (
            <RevisionWorkbench
              key={`${selected.route_id}:${revision?.route_revision_id ?? "new"}`}
              route={selected}
              revision={revision}
              revisions={selected.revisions}
              modalities={modalities}
              timeZone={timeZone}
            />
          )}
        </>
      ) : null}

      {dialog === "create" ? <RouteFormDialog mode="create" editionId={editionId} modalities={modalities} onClose={() => setDialog(null)} /> : null}
      {dialog === "duplicate" && selectedRoute ? (
        <RouteFormDialog mode="duplicate" editionId={editionId} source={selectedRoute} modalities={modalities} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "import" && selected ? (
        <GpxImportDialog routeId={selected.route_id} routeName={selected.name} hasRevisions={selected.revisions.length > 0} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
