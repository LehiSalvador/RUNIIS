"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { formatMoney } from "@/lib/client/account-format";
import { useReturnFocus } from "@/components/admin/use-return-focus";
import { RequestFailureNotice } from "@/components/admin/requests/failure-notice";
import { isTransientFailure, placesOf, priceChange, type QueueRequest } from "@/components/admin/requests/request-logic";

/**
 * Confirm a request (J2 steps 2-3). Before expiry it is the plain confirm; after expiry the same button runs the explicit
 * revalidation (price, capacity, eligibility and acceptances are checked again by the server). A changed price blocks with
 * PRICE_CHANGED: the dialog shows both totals and only an explicit second decision ("confirmar con el precio vigente") repeats the
 * call acknowledging the current total, under a NEW Idempotency-Key (a new intent). Nothing is shown as confirmed until the server
 * answers with a CONFIRMED request.
 */
export function ConfirmRequestDialog({
  request,
  mode,
  onClose,
}: {
  request: QueueRequest;
  mode: "confirm" | "revalidate";
  onClose: () => void;
}) {
  const pendingRef = React.useRef(false);
  const returnFocus = useReturnFocus();
  return (
    <Modal open onOpenChange={(next) => (!next && !pendingRef.current ? onClose() : undefined)}>
      <ModalContent
        {...returnFocus}
        title={mode === "revalidate" ? `Revalidar y confirmar ${request.public_reference}` : `Confirmar ${request.public_reference}`}
        description={
          mode === "revalidate"
            ? "La solicitud ya expiró. El servidor revisa de nuevo precio, cupo, elegibilidad y aceptaciones; si todo sigue válido la confirma."
            : "Se crean las inscripciones y los pases. El servidor vuelve a revisar cupo, elegibilidad y aceptaciones antes de confirmar."
        }
      >
        <ConfirmBody request={request} mode={mode} onClose={onClose} pendingRef={pendingRef} />
      </ModalContent>
    </Modal>
  );
}

function ConfirmBody({
  request,
  mode,
  onClose,
  pendingRef,
}: {
  request: QueueRequest;
  mode: "confirm" | "revalidate";
  onClose: () => void;
  pendingRef: React.MutableRefObject<boolean>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  // One key per intent: retries of the same decision reuse it; acknowledging a new price is a new decision.
  const [intent, setIntent] = React.useState<{ key: string; expectedTotalMinor: number | null }>(() => ({ key: newIdempotencyKey(), expectedTotalMinor: null }));
  const places = placesOf(request);
  const change = failure ? priceChange(failure) : null;

  async function run(next: { key: string; expectedTotalMinor: number | null }) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      const path =
        mode === "revalidate"
          ? `/api/v1/admin/registration-requests/${request.registration_request_id}/revalidate-and-confirm`
          : `/api/v1/admin/registration-requests/${request.registration_request_id}/confirm`;
      const body = mode === "revalidate" && next.expectedTotalMinor !== null ? { expected_total_minor: next.expectedTotalMinor } : mode === "revalidate" ? {} : undefined;
      const result = await apiFetch<{ status?: string }>(path, { method: "POST", body, idempotencyKey: next.key });
      if (result.ok && result.data.status === "CONFIRMED") {
        toast({ tone: "success", title: "Solicitud confirmada", description: "Las inscripciones y los pases ya están emitidos." });
        onClose();
        router.refresh();
      } else if (result.ok) {
        // A 200 that is not CONFIRMED is never presented as success.
        setFailure({ ok: false, status: 200, code: "INTERNAL_ERROR", message: "", requestId: null, details: {} });
        router.refresh();
      } else {
        setFailure(result);
        if (!isTransientFailure(result)) setIntent((current) => ({ ...current, key: newIdempotencyKey() }));
        if (result.code === "REQUEST_EXPIRED" || result.code === "CONFLICT") router.refresh();
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <dl className="grid gap-2 rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm sm:grid-cols-2">
        <div>
          <dt className="text-caption text-ink-60">Comprador</dt>
          <dd className="font-semibold text-ink">{request.buyer?.full_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-60">Lugares</dt>
          <dd className="font-semibold text-ink">{places}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-caption text-ink-60">Total de la solicitud (aún sin pago confirmado)</dt>
          <dd className="font-semibold tabular-nums text-ink">{formatMoney(request.total_snapshot_minor, request.currency)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-body-sm text-ink-80">Confirma solo cuando hayas verificado el pago con el comprador por WhatsApp: la plataforma no cobra.</p>

      {change ? (
        <div className="mt-3 rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink" data-testid="price-change">
          <p className="font-semibold">El precio cambió desde que se creó la solicitud.</p>
          <p>
            Total en la solicitud: <strong className="tabular-nums">{formatMoney(change.snapshotMinor, change.currency)}</strong>. Precio vigente:{" "}
            <strong className="tabular-nums">{formatMoney(change.currentMinor, change.currency)}</strong>.
          </p>
          <p>Coordina con el comprador. Si están de acuerdo, confirma con el precio vigente.</p>
        </div>
      ) : null}

      {failure ? (
        <RequestFailureNotice
          className="mt-3"
          failure={failure}
          participants={request.participants}
          onRetry={change ? undefined : () => void run(intent)}
        />
      ) : null}

      <ModalActions>
        <ModalClose asChild>
          <Button variant="secondary" disabled={pending}>
            {failure ? "Cerrar" : "Cancelar"}
          </Button>
        </ModalClose>
        {change && mode === "revalidate" ? (
          <Button
            loading={pending}
            onClick={() => {
              const next = { key: newIdempotencyKey(), expectedTotalMinor: change.currentMinor };
              setIntent(next);
              void run(next);
            }}
          >
            Confirmar con el precio vigente ({formatMoney(change.currentMinor, change.currency)})
          </Button>
        ) : (
          <Button loading={pending} onClick={() => void run(intent)}>
            {mode === "revalidate" ? "Revalidar y confirmar" : "Confirmar solicitud"}
          </Button>
        )}
      </ModalActions>
    </>
  );
}
