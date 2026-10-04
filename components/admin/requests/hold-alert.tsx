"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCw, ShieldAlert } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { RequestFailureNotice } from "@/components/admin/requests/failure-notice";
import { isRouteAvailable } from "@/components/shell/nav-availability";
import { formatDateTime } from "@/components/admin/format";
import { parseHoldAlert, queueHref, shareOfCapacity, TRIGGER_TEXT, type AlertTask } from "@/components/admin/requests/hold-alert-logic";

/**
 * The hold-concentration alert of the Edition (OD-P2-01, task `hold-concentration:{edition}`). It DETECTS and ALERTS: it links to the
 * affected requests and states, every time, that nothing is cancelled automatically: cancelling is the staff's decision, one request or a
 * selection at a time. "Recalcular" asks the server to recompute the Edition's projected tasks now (the cron does it every 5 min); the
 * alert shown is whatever the server answers, never computed here.
 */
export function HoldAlert({ editionId, task, timeZone }: { editionId: string; task: AlertTask | null; timeZone: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [key, setKey] = React.useState(() => newIdempotencyKey());

  async function recompute() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await apiFetch("/api/v1/admin/tasks/refresh", { method: "POST", body: { edition_id: editionId }, idempotencyKey: key });
      if (result.ok) {
        setKey(newIdempotencyKey());
        toast({ tone: "success", title: "Alerta recalculada" });
        router.refresh();
      } else {
        setFailure(result);
      }
    } finally {
      setPending(false);
    }
  }

  const recomputeButton = (
    <Button variant="secondary" size="sm" loading={pending} onClick={() => void recompute()}>
      <RotateCw className="size-4" aria-hidden="true" />
      Recalcular alerta
    </Button>
  );

  if (!task) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-divider bg-paper-raised px-4 py-2" data-testid="hold-alert-none">
        <p className="flex items-center gap-2 text-body-sm text-ink-80">
          <ShieldAlert className="size-4 text-ink-60" aria-hidden="true" />
          Sin alerta de acaparamiento: los apartados pendientes están dentro de lo normal.
        </p>
        {recomputeButton}
        {failure ? <RequestFailureNotice className="w-full" failure={failure} onRetry={() => void recompute()} /> : null}
      </div>
    );
  }

  const alert = parseHoldAlert(task.metadata);
  const share = shareOfCapacity(alert);
  const tasksLink = isRouteAvailable("/admin/tareas") ? `/admin/tareas?edition_id=${editionId}&category=ANTI_HOARDING` : null;

  return (
    <div data-testid="hold-alert">
      <Alert tone="warning" title={task.title} action={recomputeButton}>
        <p>{task.description}</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {alert.triggers.map((trigger) => (
            <li key={trigger}>{TRIGGER_TEXT[trigger]}</li>
          ))}
        </ul>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
          {alert.pendingPlaces !== null ? (
            <div>
              <dt className="inline text-ink-60">Lugares apartados: </dt>
              <dd className="inline font-semibold tabular-nums">
                {alert.pendingPlaces}
                {alert.capacity ? ` de ${alert.capacity}` : ""}
                {share !== null ? ` (${share} %)` : ""}
              </dd>
            </div>
          ) : null}
          {alert.pendingRequests !== null ? (
            <div>
              <dt className="inline text-ink-60">Solicitudes pendientes: </dt>
              <dd className="inline font-semibold tabular-nums">{alert.pendingRequests}</dd>
            </div>
          ) : null}
          {alert.topBuyerPlaces !== null ? (
            <div>
              <dt className="inline text-ink-60">Máximo por una cuenta: </dt>
              <dd className="inline font-semibold tabular-nums">{alert.topBuyerPlaces}</dd>
            </div>
          ) : null}
        </dl>
        {alert.modalities.length > 0 ? (
          <p className="mt-2">
            Modalidades con mucho cupo apartado:{" "}
            {alert.modalities.map((modality) => `${modality.name} (${modality.pendingPlaces} de ${modality.capacity})`).join(", ")}.
          </p>
        ) : null}
        {alert.topRequests.length > 0 ? (
          <div className="mt-2">
            <p className="font-semibold">Solicitudes que más retienen</p>
            <ul className="mt-1 flex flex-wrap gap-2" aria-label="Solicitudes afectadas">
              {alert.topRequests.map((request) => (
                <li key={request.id}>
                  <Link
                    href={queueHref(editionId, { status: "PENDING_CONFIRMATION", search: request.reference })}
                    prefetch={false}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-warning-border bg-paper-raised px-2.5 py-1 text-caption font-semibold text-ink hover:border-ink-60"
                  >
                    <span className="font-mono">{request.reference}</span>
                    <span className="tabular-nums text-ink-60">
                      {request.places} {request.places === 1 ? "lugar" : "lugares"}
                      {request.newAccount ? " · cuenta nueva" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-2 font-semibold">Nada se cancela automáticamente. Revisa las solicitudes y cancela solo las sospechosas.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Link href={queueHref(editionId, { status: "PENDING_CONFIRMATION" })} prefetch={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Ver solicitudes pendientes
          </Link>
          {tasksLink ? (
            <Link href={tasksLink} prefetch={false} className="text-body-sm font-semibold text-ink underline underline-offset-4">
              Abrir la tarea
            </Link>
          ) : (
            <span className="text-caption text-ink-60">Tarea {task.admin_task_id.slice(0, 8)}</span>
          )}
          <span className="text-caption text-ink-60">
            Detectada {formatDateTime(task.detected_at, timeZone)}
            {alert.reopenedAfterWaive ? " · volvió a abrirse tras descartarla" : ""}
          </span>
        </div>
      </Alert>
      {failure ? <RequestFailureNotice className="mt-2" failure={failure} onRetry={() => void recompute()} /> : null}
    </div>
  );
}
