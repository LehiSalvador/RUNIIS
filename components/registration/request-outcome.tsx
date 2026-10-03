"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, MessageCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CountdownStatus } from "@/components/ui/countdown-status";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/account/confirm-dialog";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import { formatDateTime, formatMoney, pluralize } from "@/lib/client/account-format";
import { presentRequest } from "@/lib/client/request-status";
import type { RegistrationRequestView } from "@/lib/shared/registration-views";

export type OutcomeRequest = RegistrationRequestView & { whatsapp_url: string | null };

function participantName(participant: OutcomeRequest["participants"][number]): string {
  if (participant.is_buyer) return "Tú";
  return participant.display_name ?? (participant.participant_kind === "GUEST" ? "Invitado" : "Participante");
}

function cancelFailure(failure: ApiFailure): string {
  if (failure.code === "CONFLICT" || failure.code === "REQUEST_EXPIRED" || failure.code === "RESOURCE_EXPIRED") {
    return "La solicitud ya cambió de estado (confirmada, cancelada o expirada). Cierra para ver su estado actual.";
  }
  return errorMessage(failure);
}

function looksLikeRequest(value: unknown): value is OutcomeRequest {
  return Boolean(value) && typeof value === "object" && typeof (value as { registration_request_id?: unknown }).registration_request_id === "string" && Array.isArray((value as { participants?: unknown }).participants);
}

/**
 * Resultado (ux-spec J1 steps 6-9, ui-spec §4.9): replaces the stepper. FREE: instant confirmation with the
 * Registration numbers and pass links. EXTERNAL_WHATSAPP: pending screen with the public reference, the
 * absolute countdown from the server's expires_at (+ server_time), the wa.me handoff built by the server
 * (edition + reference only) and cancel. Never "pagado": a request is "apartado" until staff confirms.
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
  const [expired, setExpired] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const cancelKey = React.useRef(newIdempotencyKey());

  const status = expired && request.effective_status === "PENDING_CONFIRMATION" ? "EXPIRED" : request.effective_status;
  const presentation = presentRequest(status, request.registration_mode);
  const pending = status === "PENDING_CONFIRMATION";
  const confirmed = status === "CONFIRMED";
  const free = request.registration_mode === "FREE";

  async function cancel(): Promise<ApiFailure | null> {
    const trimmed = reason.trim();
    const result = await apiFetch<OutcomeRequest>(`/api/v1/registration-requests/${request.registration_request_id}/cancel`, {
      method: "POST",
      body: trimmed ? { reason: trimmed } : {},
      idempotencyKey: cancelKey.current,
    });
    if (!result.ok) {
      cancelKey.current = newIdempotencyKey();
      return result;
    }
    const canceled: OutcomeRequest = looksLikeRequest(result.data)
      ? { ...result.data, whatsapp_url: null }
      : { ...request, status: "CANCELED_BY_BUYER", effective_status: "CANCELED_BY_BUYER", whatsapp_url: null };
    setRequest(canceled);
    toast({ tone: "info", title: "Solicitud cancelada", description: "Los lugares apartados se liberaron." });
    onCanceled(canceled);
    return null;
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

      {pending && request.expires_at ? (
        <section aria-label="Apartado" className="flex flex-col gap-5 rounded-panel border border-divider bg-paper-raised p-5 md:flex-row md:items-end md:justify-between md:p-6" data-testid="hold-panel">
          <CountdownStatus label="El apartado vence en" expiresAt={request.expires_at} serverNow={request.server_time} onExpire={() => setExpired(true)} />
          <div className="flex flex-col gap-2 md:items-end">
            {request.whatsapp_url ? (
              <Button asChild size="lg" className="w-full md:w-auto">
                <a href={request.whatsapp_url} target="_blank" rel="noopener noreferrer" data-testid="whatsapp-handoff">
                  <MessageCircle className="size-5" aria-hidden="true" />
                  Continuar por WhatsApp
                  <span className="sr-only"> (se abre en una pestaña nueva)</span>
                </a>
              </Button>
            ) : null}
            <p className="text-caption text-ink-60">Apartar no es pagar: el organizador confirma tu inscripción. El tiempo no se extiende por abrir WhatsApp ni por recargar esta página.</p>
          </div>
        </section>
      ) : null}

      {status === "EXPIRED" ? (
        <Alert
          tone="warning"
          title="El apartado venció"
          action={
            <Link href={`/eventos/${request.edition.slug}`} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-ink underline underline-offset-4">
              Ir a la página del evento
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          }
        >
          Los lugares se liberaron y esta solicitud ya no puede confirmarse. Puedes empezar una nueva si todavía hay cupo.
        </Alert>
      ) : null}

      <section aria-labelledby="outcome-participants-heading" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4 border-b border-divider pb-3">
          <h3 id="outcome-participants-heading" className="text-h4 font-bold text-ink">
            {pluralize(request.participants.length, "participante", "participantes")}
          </h3>
          <p className="text-body-sm text-ink-60">
            Total{" "}
            <span className="font-display text-h3 font-bold text-ink tabular-nums" data-testid="outcome-total">
              {formatMoney(request.total_snapshot_minor, request.currency)}
            </span>
          </p>
        </div>
        <ul className="divide-y divide-divider rounded-card border border-divider bg-paper-raised">
          {request.participants.map((participant) => (
            <li key={participant.request_participant_id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="outcome-participant">
              <div className="min-w-0">
                <p className="text-body font-semibold text-ink">{participantName(participant)}</p>
                <p className="mt-0.5 text-body-sm text-ink-80">
                  {participant.modality.name}
                  {participant.category ? ` · ${participant.category.name}` : ""}
                </p>
                {pending ? (
                  <p className="mt-1 text-body-sm">
                    {participant.legal_acceptance_status === "ACCEPTED" ? (
                      <span className="text-success">Documentos aceptados</span>
                    ) : (
                      <span className="text-warning">
                        {participant.is_buyer ? "Te falta aceptar los documentos" : `Pendiente de aceptación de ${participantName(participant)}`}
                      </span>
                    )}
                  </p>
                ) : null}
                {participant.registration ? (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-body-sm text-ink-60">
                    <CircleCheck className="size-4 text-success" aria-hidden="true" />
                    <span>
                      Inscripción <span className="font-semibold text-ink tabular-nums">{participant.registration.registration_number}</span>
                    </span>
                    {participant.registration.participant_pass_id ? (
                      <Link href={`/cuenta/pases/${participant.registration.participant_pass_id}`} className="font-semibold text-ink underline underline-offset-4">
                        Ver pase<span className="sr-only"> de {participantName(participant)}</span>
                      </Link>
                    ) : (
                      <span>{participant.is_buyer ? "Tu pase se está preparando." : "Recibirá su pase en su propia cuenta."}</span>
                    )}
                  </p>
                ) : null}
              </div>
              <p className="text-body font-semibold text-ink tabular-nums sm:text-right">{formatMoney(participant.price_snapshot_minor, request.currency)}</p>
            </li>
          ))}
        </ul>
      </section>

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

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="¿Cancelar esta solicitud?"
        description={`Se liberan de inmediato los lugares de ${pluralize(request.participants.length, "participante", "participantes")}. No se puede deshacer. Si ya acordaste algo con el organizador, avísale por WhatsApp.`}
        confirmLabel="Sí, cancelar solicitud"
        onConfirm={cancel}
        describeFailure={cancelFailure}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="outcome-cancel-reason" className="text-label font-semibold text-ink">
            Motivo (opcional)
          </label>
          <textarea
            id="outcome-cancel-reason"
            value={reason}
            maxLength={500}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-control border border-control bg-paper-raised px-4 py-3 text-body text-ink hover:border-ink-60 focus-visible:border-ink"
          />
          <p className="text-caption text-ink-60">Lo verá el organizador.</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
