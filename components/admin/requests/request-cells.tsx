"use client";

import React from "react";
import { Hourglass, TimerOff } from "lucide-react";
import type { RequestStatus } from "@/lib/shared/registration";
import { formatDateTimeShort } from "@/components/admin/format";
import { AdminBadge } from "@/components/admin/status-badges";
import { formatCountdown, remainingMs, STATUS_SPEC, type QueueRequest } from "@/components/admin/requests/request-logic";

/** The effective status as an icon + label badge (never colour alone). When the stored status lags the effective one, say so. */
export function StatusCell({ request, effective }: { request: QueueRequest; effective: RequestStatus }) {
  const spec = STATUS_SPEC[effective];
  const lagging = request.status !== effective;
  return (
    <div className="flex flex-col items-start gap-1">
      <AdminBadge icon={spec.icon} tone={spec.tone}>
        {spec.short}
        {spec.short !== spec.label ? <span className="sr-only">: {spec.label}</span> : null}
      </AdminBadge>
      {lagging ? <span className="max-w-32 text-caption text-ink-60">El sistema aún no la marca como expirada</span> : null}
    </div>
  );
}

/**
 * "Expiración efectiva" (UX J2 step 1): the ABSOLUTE expiry in the Edition's zone with its own icon and text, plus a countdown from the
 * server's clock while the request is still pending. It is independent of the stored status column: a request past its expiry reads
 * as expired here even when the worker has not run.
 */
export function ExpiryCell({ request, effective, nowMs, timeZone }: { request: QueueRequest; effective: RequestStatus; nowMs: number; timeZone: string }) {
  if (!request.expires_at) return <span className="text-ink-60">Sin vencimiento</span>;
  const absolute = formatDateTimeShort(request.expires_at, timeZone);
  const left = remainingMs(request, nowMs);
  if (effective === "PENDING_CONFIRMATION" && left !== null) {
    return (
      <div className="flex items-start gap-1.5">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
        <div>
          <p className="font-semibold tabular-nums text-ink">Vence {absolute}</p>
          <p className="text-caption tabular-nums text-ink-60" data-testid="countdown">
            Quedan {formatCountdown(left)}
          </p>
        </div>
      </div>
    );
  }
  if (effective === "EXPIRED") {
    return (
      <div className="flex items-start gap-1.5">
        <TimerOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-semibold tabular-nums text-ink">Expiró {absolute}</p>
          <p className="text-caption text-ink-60">Ya no retiene cupo</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="tabular-nums text-ink-80">{absolute}</p>
      <p className="text-caption text-ink-60">Vencimiento original</p>
    </div>
  );
}
