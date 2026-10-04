"use client";

import React from "react";
import { Inbox, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatMoney } from "@/lib/client/account-format";
import { DetailDrawer } from "@/components/admin/detail-drawer";
import { formatDateTimeShort } from "@/components/admin/format";
import { AdminBadge } from "@/components/admin/status-badges";
import { CancelRequestDialog } from "@/components/admin/requests/cancel-request-dialog";
import { BulkCancelDialog } from "@/components/admin/requests/bulk-cancel-dialog";
import { ConfirmRequestDialog } from "@/components/admin/requests/confirm-request-dialog";
import { RequestDetail } from "@/components/admin/requests/request-detail";
import { ExpiryCell, StatusCell } from "@/components/admin/requests/request-cells";
import {
  BULK_CANCEL_MAX_REQUESTS,
  bulkEligibleIds,
  canBulkCancel,
  canCancelRequest,
  confirmMode,
  effectiveStatusAt,
  pruneSelection,
  selectionSummary,
  serverNowMs,
  type QueueRequest,
} from "@/components/admin/requests/request-logic";
import { useElapsed } from "@/components/admin/requests/use-elapsed";

/**
 * The external request queue (T13 §4.12, UX J2). One row per request with the exact columns of the spec: reference, buyer,
 * participants, modalities, price, creation, EFFECTIVE expiry, status, actions. Expiry is read from the server's clock, so a request
 * that crossed its expiry reads as expired here before the worker materialises it. Confirm and Cancel are inline buttons (the reason
 * staff opens this table); the quick-look drawer carries the full participant list and the blocking reasons.
 *
 * Bulk cancel (OD-P2-01): explicit selection of PENDING requests only, a confirmation that names the count and the places, one internal
 * reason, per-request results. Nothing is ever cancelled automatically and a confirmed registration is never selectable.
 */
export function RequestQueue({ editionId, timeZone, requests }: { editionId: string; timeZone: string; requests: QueueRequest[] }) {
  const elapsed = useElapsed(requests[0]?.server_time ?? "none");
  const [selectedRaw, setSelected] = React.useState<Set<string>>(new Set());
  const [confirming, setConfirming] = React.useState<{ id: string; mode: "confirm" | "revalidate" } | null>(null);
  const [canceling, setCanceling] = React.useState<{ id: string; reference: string } | null>(null);
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);

  // A refresh or a filter change can drop rows: a selection never outlives its row, and never holds a row that cannot be bulk-cancelled.
  const selected = React.useMemo(() => pruneSelection(selectedRaw, requests), [selectedRaw, requests]);
  const summary = selectionSummary(selected, requests);
  const eligible = bulkEligibleIds(requests);
  const allEligibleSelected = eligible.length > 0 && eligible.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allEligibleSelected;
  const overLimit = selected.size > BULK_CANCEL_MAX_REQUESTS;
  const byId = React.useMemo(() => new Map(requests.map((request) => [request.registration_request_id, request])), [requests]);

  const nowOf = (request: QueueRequest) => serverNowMs(request, elapsed);
  const effectiveOf = (request: QueueRequest) => effectiveStatusAt(request, nowOf(request));

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const columns = React.useMemo<DataTableColumn<QueueRequest>[]>(
    () => [
      {
        key: "select",
        header: "Elegir",
        priority: 1,
        render: (row) => {
          const selectable = canBulkCancel(row);
          return (
            <Checkbox
              className="-mx-3"
              checked={selected.has(row.registration_request_id)}
              disabled={!selectable}
              onCheckedChange={(checked) => toggle(row.registration_request_id, checked === true)}
              aria-label={selectable ? `Seleccionar ${row.public_reference}` : `${row.public_reference}: no se puede cancelar en lote`}
            />
          );
        },
      },
      {
        key: "reference",
        header: "Referencia",
        priority: 2,
        render: (row) => (
          <div>
            {/* The reference opens the quick look: the same action as the row's detail, without spending a column on it. */}
            <button
              type="button"
              aria-label={`Detalle de ${row.public_reference}`}
              onClick={() => setViewing(row.registration_request_id)}
              className="inline-flex min-h-9 items-center rounded-control font-mono text-caption font-semibold text-ink underline underline-offset-4 hover:text-ink-80"
            >
              {row.public_reference}
            </button>
            <p className="hidden text-caption tabular-nums text-ink-60 lg:block">Creada {formatDateTimeShort(row.created_at, timeZone)}</p>
          </div>
        ),
      },
      { key: "status", header: "Estado", priority: 3, render: (row) => <StatusCell request={row} effective={effectiveOf(row)} /> },
      {
        key: "expiry",
        header: "Expiración efectiva",
        priority: 4,
        render: (row) => <ExpiryCell request={row} effective={effectiveOf(row)} nowMs={nowOf(row)} timeZone={timeZone} />,
      },
      {
        key: "buyer",
        header: "Comprador",
        priority: 5,
        render: (row) => (
          <div className="min-w-0">
            <p className="max-w-32 font-semibold text-ink">{row.buyer?.full_name ?? "—"}</p>
            {row.buyer ? <p className="font-mono text-caption text-ink-60">{row.buyer.phone_e164}</p> : null}
            {row.buyer?.is_new_account ? (
              <AdminBadge icon={Inbox} tone="warning" className="mt-1">
                Cuenta nueva
              </AdminBadge>
            ) : null}
          </div>
        ),
      },
      {
        key: "participants",
        header: "Participantes",
        priority: 6,
        render: (row) => <ParticipantsCell request={row} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cell renderers read `elapsed` and `selected`; the table re-renders with them.
    [timeZone, elapsed, selected],
  );

  const confirmTarget = confirming ? byId.get(confirming.id) : undefined;
  const viewTarget = viewing ? byId.get(viewing) : undefined;
  const bulkRequests = requests.filter((request) => selected.has(request.registration_request_id));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-divider bg-paper-raised px-3 py-2" data-testid="bulk-bar">
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            checked={someSelected ? "indeterminate" : allEligibleSelected}
            disabled={eligible.length === 0}
            onCheckedChange={(checked) => setSelected(checked === true ? new Set(eligible) : new Set())}
            aria-label="Seleccionar todas las solicitudes pendientes de esta página"
          />
          <p className="text-body-sm text-ink-80" role="status" aria-live="polite" data-testid="selection-summary">
            {selected.size === 0
              ? eligible.length === 0
                ? "No hay solicitudes pendientes que se puedan cancelar en lote en esta página."
                : "Elige solicitudes pendientes para cancelarlas en lote."
              : `${summary.requests} ${summary.requests === 1 ? "solicitud elegida" : "solicitudes elegidas"} · ${summary.places} ${summary.places === 1 ? "lugar" : "lugares"}`}
            {overLimit ? ` (máximo ${BULK_CANCEL_MAX_REQUESTS} por tanda)` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Quitar selección
            </Button>
          ) : null}
          <Button variant="danger" size="sm" disabled={selected.size === 0 || overLimit} onClick={() => setBulkOpen(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            Cancelar seleccionadas{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </div>
      </div>

      <DataTable
        caption="Solicitudes de inscripción por WhatsApp"
        columns={columns}
        rows={requests}
        getRowId={(row) => row.registration_request_id}
        getRowLabel={(row) => row.public_reference}
        keepColumnsBelowLg={3}
        keepColumnsBelowMd={3}
        emptyState={{ icon: Inbox, title: "No hay solicitudes con estos filtros", description: "Cambia el estado o la búsqueda, o limpia los filtros.", headingLevel: "h3" }}
        rowActions={(row) => {
          const effective = effectiveOf(row);
          const mode = confirmMode(row, effective);
          return (
            <div className="flex w-24 flex-col items-stretch gap-1 md:ml-auto">
              {mode ? (
                <Button size="sm" onClick={() => setConfirming({ id: row.registration_request_id, mode })}>
                  {mode === "revalidate" ? "Revalidar" : "Confirmar"}
                  <span className="sr-only">{mode === "revalidate" ? " y confirmar" : ""} {row.public_reference}</span>
                </Button>
              ) : null}
              {canCancelRequest(row) ? (
                <Button size="sm" variant="secondary" onClick={() => setCanceling({ id: row.registration_request_id, reference: row.public_reference })}>
                  Cancelar<span className="sr-only"> {row.public_reference}</span>
                </Button>
              ) : null}
            </div>
          );
        }}
      />

      {confirmTarget && confirming ? <ConfirmRequestDialog key={confirmTarget.registration_request_id} request={confirmTarget} mode={confirming.mode} onClose={() => setConfirming(null)} /> : null}

      {canceling ? <CancelRequestDialog key={canceling.id} requestId={canceling.id} reference={canceling.reference} onClose={() => setCanceling(null)} /> : null}

      <DetailDrawer
        open={viewTarget !== undefined}
        onOpenChange={(open) => !open && setViewing(null)}
        title={viewTarget ? `Solicitud ${viewTarget.public_reference}` : "Solicitud"}
        description="Detalle de la solicitud, el comprador y los participantes."
        footer={
          viewTarget ? (
            <div className="flex flex-wrap justify-end gap-2">
              {confirmMode(viewTarget, effectiveOf(viewTarget)) ? (
                <Button
                  size="sm"
                  onClick={() => {
                    const mode = confirmMode(viewTarget, effectiveOf(viewTarget));
                    setViewing(null);
                    if (mode) setConfirming({ id: viewTarget.registration_request_id, mode });
                  }}
                >
                  {confirmMode(viewTarget, effectiveOf(viewTarget)) === "revalidate" ? "Revalidar y confirmar" : "Confirmar"}
                </Button>
              ) : null}
              {canCancelRequest(viewTarget) ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setViewing(null);
                    setCanceling({ id: viewTarget.registration_request_id, reference: viewTarget.public_reference });
                  }}
                >
                  Cancelar solicitud
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {viewTarget ? <RequestDetail request={viewTarget} effective={effectiveOf(viewTarget)} nowMs={nowOf(viewTarget)} timeZone={timeZone} /> : null}
      </DetailDrawer>

      {bulkOpen ? (
        <BulkCancelDialog
          editionId={editionId}
          requests={bulkRequests}
          places={summary.places}
          onClose={() => setBulkOpen(false)}
          onFinished={(failed) => setSelected(new Set(failed))}
        />
      ) : null}
    </div>
  );
}

function ParticipantsCell({ request }: { request: QueueRequest }) {
  const names = request.participants.map((participant) => participant.display_name ?? "Sin nombre");
  const shown = names.slice(0, 2);
  const pending = request.participants.filter((participant) => participant.legal_acceptance_status === "PENDING");
  return (
    <div className="min-w-0">
      <p className="max-w-48 text-ink">
        <span className="tabular-nums font-semibold">{names.length}</span> · {shown.join(", ")}
        {names.length > shown.length ? ` y ${names.length - shown.length} más` : ""}
      </p>
      <p className="text-caption text-ink-60">
        {modalitiesText(request)} · <span className="tabular-nums">{formatMoney(request.total_snapshot_minor, request.currency)}</span>
      </p>
      {pending.length > 0 ? (
        <p className="text-caption text-warning">
          Pendiente de aceptación de {pending.map((participant) => participant.display_name ?? "un participante").join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function modalitiesText(request: QueueRequest): string {
  const counts = new Map<string, number>();
  for (const participant of request.participants) counts.set(participant.modality.name, (counts.get(participant.modality.name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(", ") || "—";
}
