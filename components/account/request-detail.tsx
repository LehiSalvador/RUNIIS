"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Fact } from "@/components/account/section";
import { CancelRequestDialog, ExpiredNotice, HoldPanel, RequestParticipants, RequestStages, useLiveRequestStatus } from "@/components/registration/request-parts";
import { formatDateTime } from "@/lib/client/account-format";
import type { RequestView } from "@/lib/client/account-types";
import { presentRequest } from "@/lib/client/request-status";

/**
 * J1 outcome view for the buyer, in the account. It is the same view /inscripcion shows after sending (the hold
 * panel, expired notice, participants, stages and cancel are components/registration/request-parts): the REQUEST,
 * the HOLD (WhatsApp only: server countdown, server-built wa.me) and the REGISTRATION stay distinguishable, and
 * "Apartado" never reads as paid.
 */
export function RequestDetail({ request }: { request: RequestView }) {
  const router = useRouter();
  const [status, markExpired] = useLiveRequestStatus(request);
  const presentation = presentRequest(status, request.registration_mode);
  const pending = status === "PENDING_CONFIRMATION";
  const [cancelOpen, setCancelOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-8">
      <Link href="/cuenta/solicitudes" className="inline-flex min-h-11 items-center gap-1.5 self-start text-body-sm font-semibold text-ink-80 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Todas las solicitudes
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge state={presentation.badge} label={presentation.label} />
          {pending ? (
            <span className="text-body-sm text-ink-60">
              Referencia <span className="font-semibold tracking-[0.04em] text-ink tabular-nums" data-testid="public-reference">{request.public_reference}</span>
            </span>
          ) : null}
        </div>
        <h2 className="font-display text-h2 font-bold text-ink">
          <Link href={`/eventos/${request.edition.slug}`} className="hover:underline hover:underline-offset-8">
            {request.edition.name}
          </Link>
        </h2>
        <p className="max-w-[var(--container-reading)] text-body text-ink-80" data-testid="request-summary">
          {presentation.summary}
        </p>
      </header>

      {pending ? <HoldPanel request={request} onExpire={markExpired} testId="hold-panel" /> : null}

      {status === "EXPIRED" ? <ExpiredNotice request={request} /> : null}

      <RequestStages status={status} mode={request.registration_mode} />

      <RequestParticipants request={request} status={status} />

      <dl className="grid gap-5 rounded-card border border-divider bg-paper-raised p-5 sm:grid-cols-3">
        <Fact label="Creada">{formatDateTime(request.created_at)}</Fact>
        {request.confirmed_at ? <Fact label="Confirmada">{formatDateTime(request.confirmed_at)}</Fact> : null}
        {request.canceled_at ? <Fact label="Cancelada">{formatDateTime(request.canceled_at)}</Fact> : null}
        {pending && request.expires_at ? <Fact label="Vence">{formatDateTime(request.expires_at)}</Fact> : null}
        <Fact label="Modo">{request.registration_mode === "FREE" ? "Evento gratuito" : "Confirmación por WhatsApp"}</Fact>
      </dl>

      {pending ? (
        <div className="flex flex-col gap-2 border-t border-divider pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-sm text-ink-60">¿Ya no vas a participar? Cancela para liberar los lugares.</p>
          <Button variant="secondary" onClick={() => setCancelOpen(true)} className="w-full border-danger-border text-danger sm:w-auto">
            Cancelar solicitud
          </Button>
        </div>
      ) : null}

      <CancelRequestDialog request={request} open={cancelOpen} onOpenChange={setCancelOpen} onCanceled={() => router.refresh()} />
    </div>
  );
}
