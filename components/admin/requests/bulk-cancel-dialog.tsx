"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Ban as BanIcon, CircleAlert as CircleAlertIcon, CircleCheck as CircleCheckIcon, MinusCircle as MinusCircleIcon, SearchX as SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { bulkCancelResultSchema, type BulkCancelResult } from "@/lib/shared/registration";
import { AdminBadge } from "@/components/admin/status-badges";
import { useReturnFocus } from "@/components/admin/use-return-focus";
import { RequestFailureNotice } from "@/components/admin/requests/failure-notice";
import {
  BULK_OUTCOME_SPEC,
  bulkOutcomeText,
  bulkSummary,
  failedIds,
  isTransientFailure,
  type QueueRequest,
} from "@/components/admin/requests/request-logic";

/**
 * Bulk cancel of PENDING requests (OD-P2-01, staff only, never automatic). Three beats, all driven by the server:
 *  1. confirmation: the exact number of requests and places, the reason (internal), and what happens;
 *  2. the call, under ONE Idempotency-Key per intent (a network retry or a 429 retry replays it; it is renewed only for a new decision);
 *  3. the per-request results (partial success is normal): canceled, already canceled, not cancelable (with its current status),
 *     not found, failed. Nothing is reported as canceled until the server says so for that id.
 * The reason stays internal: the buyer is not emailed by this command, which the dialog says plainly.
 */
export function BulkCancelDialog({
  editionId,
  requests,
  places,
  onClose,
  onFinished,
}: {
  editionId: string;
  requests: readonly QueueRequest[];
  places: number;
  onClose: () => void;
  /** Called with the ids that FAILED so the queue can keep them selected for a retry. */
  onFinished: (failed: string[]) => void;
}) {
  const pendingRef = React.useRef(false);
  const returnFocus = useReturnFocus();
  const [result, setResult] = React.useState<BulkCancelResult | null>(null);
  const finish = () => {
    onFinished(result ? failedIds(result) : requests.map((request) => request.registration_request_id));
    onClose();
  };
  return (
    <Modal open onOpenChange={(next) => (!next && !pendingRef.current ? finish() : undefined)}>
      <ModalContent
        {...returnFocus}
        title={result ? "Resultado de la cancelación" : `Cancelar ${requests.length} ${requests.length === 1 ? "solicitud" : "solicitudes"}`}
        description={
          result
            ? "Cada solicitud se procesó por separado. Esto es lo que respondió el servidor."
            : "Se cancelan solo las solicitudes pendientes que elegiste y se libera su cupo. Las inscripciones confirmadas no se tocan."
        }
        widthClassName="max-w-2xl"
      >
        <BulkBody
          editionId={editionId}
          requests={requests}
          places={places}
          result={result}
          onResult={setResult}
          onFinish={finish}
          pendingRef={pendingRef}
        />
      </ModalContent>
    </Modal>
  );
}

function BulkBody({
  editionId,
  requests,
  places,
  result,
  onResult,
  onFinish,
  pendingRef,
}: {
  editionId: string;
  requests: readonly QueueRequest[];
  places: number;
  result: BulkCancelResult | null;
  onResult: (result: BulkCancelResult) => void;
  onFinish: () => void;
  pendingRef: React.MutableRefObject<boolean>;
}) {
  const router = useRouter();
  const reasonId = React.useId();
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [key, setKey] = React.useState(() => newIdempotencyKey());
  const references = new Map(requests.map((request) => [request.registration_request_id, request.public_reference]));
  const trimmed = reason.trim();
  const reasonError = touched && trimmed.length === 0 ? "Escribe el motivo: queda en la auditoría." : null;

  async function submit() {
    setTouched(true);
    if (pendingRef.current || trimmed.length === 0) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      const response = await apiFetch<unknown>(`/api/v1/admin/editions/${editionId}/registration-requests/bulk-cancel`, {
        method: "POST",
        idempotencyKey: key,
        body: { request_ids: requests.map((request) => request.registration_request_id), reason: trimmed },
      });
      if (!response.ok) {
        setFailure(response);
        // A refusal about the decision ends the intent (new key next time); a lost connection or a 429 keeps it so the retry replays.
        if (!isTransientFailure(response)) setKey(newIdempotencyKey());
        return;
      }
      const parsed = bulkCancelResultSchema.safeParse(response.data);
      if (!parsed.success) {
        setFailure({ ok: false, status: 200, code: "INTERNAL_ERROR", message: "", requestId: null, details: {} });
        router.refresh();
        return;
      }
      onResult(parsed.data);
      toast({ tone: parsed.data.failed_count > 0 ? "info" : "success", title: bulkSummary(parsed.data) });
      router.refresh();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  if (result) {
    return (
      <>
        <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm font-semibold text-ink" role="status" data-testid="bulk-summary">
          {bulkSummary(result)}
        </p>
        <ul className="mt-3 max-h-72 divide-y divide-divider overflow-y-auto rounded-control border border-divider" aria-label="Resultado por solicitud" data-testid="bulk-results">
          {result.results.map((row) => (
            <li key={row.registration_request_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-body-sm">
              <span className="font-mono text-caption text-ink">{references.get(row.registration_request_id) ?? row.registration_request_id.slice(0, 8)}</span>
              <span className="flex items-center gap-2">
                <AdminBadge icon={OUTCOME_ICON[row.outcome]} tone={BULK_OUTCOME_SPEC[row.outcome].tone}>
                  {BULK_OUTCOME_SPEC[row.outcome].label}
                </AdminBadge>
                {row.outcome === "NOT_CANCELABLE" || row.outcome === "FAILED" ? <span className="text-caption text-ink-60">{bulkOutcomeText(row)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
        {result.failed_count > 0 ? (
          <p className="mt-2 text-body-sm text-ink-80">Las solicitudes con error siguen seleccionadas: ciérralo y vuelve a cancelarlas.</p>
        ) : null}
        <ModalActions>
          <Button onClick={onFinish}>Listo</Button>
        </ModalActions>
      </>
    );
  }

  return (
    <>
      <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm font-semibold text-ink" data-testid="bulk-count">
        Se cancelarán {requests.length} {requests.length === 1 ? "solicitud" : "solicitudes"} · {places} {places === 1 ? "lugar" : "lugares"} se liberan.
      </p>
      <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-6 text-body-sm text-ink-80" aria-label="Solicitudes elegidas">
        {requests.map((request) => (
          <li key={request.registration_request_id}>
            <span className="font-mono text-caption">{request.public_reference}</span> · {request.buyer?.full_name ?? "Comprador"} · {request.participants.length}{" "}
            {request.participants.length === 1 ? "lugar" : "lugares"}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-body-sm text-ink-80">
        El motivo es interno y queda en la auditoría. Esta acción no envía correo al comprador: si quieres avisarle, hazlo por WhatsApp.
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        <label htmlFor={reasonId} className="text-label font-semibold text-ink">
          Motivo (interno)
          <span aria-hidden="true" className="text-danger"> *</span>
        </label>
        <textarea
          id={reasonId}
          value={reason}
          rows={3}
          maxLength={500}
          required
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? `${reasonId}-error` : undefined}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-control border border-control bg-paper-raised px-4 py-2.5 text-body text-ink hover:border-ink-60 focus-visible:border-ink"
        />
        {reasonError ? (
          <p id={`${reasonId}-error`} className="text-caption text-danger">
            {reasonError}
          </p>
        ) : null}
      </div>
      {failure ? (
        <div className="mt-3">
          <RequestFailureNotice failure={failure} onRetry={() => void submit()} />
        </div>
      ) : null}
      <ModalActions>
        <ModalClose asChild>
          <Button variant="secondary" disabled={pending}>
            Volver
          </Button>
        </ModalClose>
        <Button variant="danger" loading={pending} onClick={() => void submit()}>
          Cancelar {requests.length} {requests.length === 1 ? "solicitud" : "solicitudes"}
        </Button>
      </ModalActions>
    </>
  );
}

const OUTCOME_ICON = {
  CANCELED: CircleCheckIcon,
  ALREADY_CANCELED: MinusCircleIcon,
  NOT_CANCELABLE: BanIcon,
  NOT_FOUND: SearchXIcon,
  FAILED: CircleAlertIcon,
} as const;
