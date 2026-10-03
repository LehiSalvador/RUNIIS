"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/client/account-format";
import type { RequestView } from "@/lib/client/account-types";
import { presentRequest } from "@/lib/client/request-status";
import type { RegistrationRequestView } from "@/lib/shared/registration-views";
import { CancelRequestDialog, ExpiredNotice, HoldPanel, RequestParticipants, RequestStages, useLiveRequestStatus } from "./request-parts";

export type OutcomeRequest = RegistrationRequestView & { whatsapp_url: string | null };

/**
 * Resultado (ux-spec J1 steps 6-9, ui-spec §4.9): replaces the stepper. FREE: instant confirmation with the
 * Registration numbers and pass links. EXTERNAL_WHATSAPP: pending screen with the public reference, the
 * absolute countdown from the server's expires_at (+ server_time), the wa.me handoff built by the server
 * (edition + reference only) and cancel. Never "pagado": a request is "apartado" until staff confirms.
 * The hold panel, expired notice, participants, stages and cancel are the same components the account's
 * request views use (./request-parts), so both places behave the same.
 */
export function RequestOutcome({
  request: initial,
  alreadyExisting = false,
  headingRef,
  onCanceled,
  onRestart,
}: {
  request: OutcomeRequest;
  /** True when the screen shows a request that was already pending before this visit. */
  alreadyExisting?: boolean;
  headingRef?: React.Ref<HTMLHeadingElement>;
  /** The server's view of the canceled request (kept on screen; the context re-read must not make it vanish). */
  onCanceled: (request: OutcomeRequest) => void;
  /** Start a new request (offered once this one expired or was canceled). */
  onRestart?: () => void;
}) {
  const [request, setRequest] = React.useState(initial);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const [status, markExpired] = useLiveRequestStatus(request);
  const presentation = presentRequest(status, request.registration_mode);
  const pending = status === "PENDING_CONFIRMATION";
  const confirmed = status === "CONFIRMED";
  const free = request.registration_mode === "FREE";

  function canceled(view: RequestView | null) {
    const next: OutcomeRequest = view ? { ...(view as OutcomeRequest), whatsapp_url: null } : { ...request, status: "CANCELED_BY_BUYER", effective_status: "CANCELED_BY_BUYER", whatsapp_url: null };
    setRequest(next);
    onCanceled(next);
  }

  const title = confirmed
    ? "¡Listo! Tu inscripción está confirmada"
    : pending
      ? alreadyExisting
        ? "Ya tienes una solicitud pendiente para este evento"
        : "Tus lugares están apartados"
      : presentation.label === "Expirada"
        ? "El apartado venció"
        : presentation.label;

  return (
    <div className="flex flex-col gap-6" data-testid="request-outcome" data-status={status}>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge state={presentation.badge} label={presentation.label} />
          {pending ? (
            <span className="text-body-sm text-ink-60">
              Referencia <span className="font-semibold tracking-[0.04em] text-ink tabular-nums" data-testid="public-reference">{request.public_reference}</span>
            </span>
          ) : null}
        </div>
        <h2 id="outcome-heading" ref={headingRef} tabIndex={-1} className="font-display text-h2 font-bold text-ink outline-none">
          {title}
        </h2>
        <p className="max-w-[var(--container-reading)] text-body text-ink-80" data-testid="outcome-summary">
          {confirmed && free
            ? "Tu inscripción gratuita quedó confirmada al instante. Cada persona tiene su propio pase; no hay pago pendiente."
            : presentation.summary}
        </p>
      </header>

      {pending ? <HoldPanel request={request} onExpire={markExpired} whatsappLabel="Continuar por WhatsApp" whatsappTestId="whatsapp-handoff" testId="hold-panel" /> : null}

      {status === "EXPIRED" ? <ExpiredNotice request={request} restart="none" /> : null}

      <RequestStages status={status} mode={request.registration_mode} />

      <RequestParticipants request={request} status={status} testIds={{ item: "outcome-participant", total: "outcome-total" }} />

      <p className="text-body-sm text-ink-60">
        Creada {formatDateTime(request.created_at)}
        {pending && request.expires_at ? <> · Vence {formatDateTime(request.expires_at)}</> : null}
      </p>

      <div className="flex flex-col gap-3 border-t border-divider pt-6 sm:flex-row sm:flex-wrap sm:items-center">
        {confirmed ? (
          <Button asChild size="lg">
            <Link href="/cuenta/pases">Ver mis pases</Link>
          </Button>
        ) : null}
        <Button asChild variant="secondary" size="lg">
          <Link href={`/cuenta/solicitudes/${request.registration_request_id}`}>Ver en mis solicitudes</Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href={`/eventos/${request.edition.slug}`}>Volver al evento</Link>
        </Button>
        {!pending && !confirmed && onRestart ? (
          <Button size="lg" onClick={onRestart}>
            Hacer una nueva solicitud
          </Button>
        ) : null}
        {pending ? (
          <Button variant="secondary" size="lg" onClick={() => setCancelOpen(true)} className="border-danger-border text-danger sm:ml-auto">
            Cancelar solicitud
          </Button>
        ) : null}
      </div>

      <CancelRequestDialog request={request} open={cancelOpen} onOpenChange={setCancelOpen} onCanceled={canceled} />
    </div>
  );
}
