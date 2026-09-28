"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CountdownStatus } from "@/components/ui/countdown-status";
import { FormField } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/account/confirm-dialog";
import { useLiveRequestStatus, WhatsAppButton } from "@/components/account/request-card";
import { Fact, KindBadge } from "@/components/account/section";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import { formatDateTime, formatMoney, pluralize } from "@/lib/client/account-format";
import type { RequestParticipantView, RequestView } from "@/lib/client/account-types";
import { presentRequest } from "@/lib/client/request-status";

function cancelFailure(failure: ApiFailure): string {
  if (failure.code === "CONFLICT" || failure.code === "REQUEST_EXPIRED" || failure.code === "RESOURCE_EXPIRED") {
    return "La solicitud ya cambió de estado (confirmada, cancelada o expirada). Cierra para ver su estado actual.";
  }
  return errorMessage(failure);
}

function participantName(participant: RequestParticipantView): string {
  if (participant.is_buyer) return "Tú";
  return participant.display_name ?? (participant.participant_kind === "GUEST" ? "Invitado" : "Amistad");
}

/**
 * J1 outcome view for the buyer: participants, modality, total snapshot and status. The hold
 * countdown comes from the server's expires_at + server_time; "Apartado" never reads as paid; the
 * WhatsApp link is the server-built handoff (edition + reference only).
 */
export function RequestDetail({ request }: { request: RequestView }) {
  const router = useRouter();
  const [status, markExpired] = useLiveRequestStatus(request);
  const presentation = presentRequest(status, request.registration_mode);
  const pending = status === "PENDING_CONFIRMATION";
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const cancelKey = React.useRef(newIdempotencyKey());

  async function cancel(): Promise<ApiFailure | null> {
    const trimmed = reason.trim();
    const result = await apiFetch(`/api/v1/registration-requests/${request.registration_request_id}/cancel`, {
      method: "POST",
      body: trimmed ? { reason: trimmed } : {},
      idempotencyKey: cancelKey.current,
    });
    if (!result.ok) {
      cancelKey.current = newIdempotencyKey();
      return result;
    }
    toast({ tone: "info", title: "Solicitud cancelada", description: "Los lugares apartados se liberaron." });
    router.refresh();
    return null;
  }

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
              Referencia <span className="font-semibold tracking-[0.04em] text-ink tabular-nums">{request.public_reference}</span>
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

      {pending && request.expires_at ? (
        <section aria-label="Apartado" className="flex flex-col gap-5 rounded-panel border border-divider bg-paper-raised p-5 md:flex-row md:items-end md:justify-between md:p-6">
          <CountdownStatus label="El apartado vence en" expiresAt={request.expires_at} serverNow={request.server_time} onExpire={markExpired} />
          <div className="flex flex-col gap-2 md:items-end">
            {request.whatsapp_url ? <WhatsAppButton href={request.whatsapp_url} size="lg" className="w-full md:w-auto" /> : null}
            <p className="text-caption text-ink-60">Apartar no es pagar: el organizador confirma tu inscripción.</p>
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
          Los lugares se liberaron y esta solicitud ya no puede confirmarse.
        </Alert>
      ) : null}

      <section aria-labelledby="participants-heading" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4 border-b border-divider pb-3">
          <h3 id="participants-heading" className="text-h4 font-bold text-ink">
            {pluralize(request.participants.length, "participante", "participantes")}
          </h3>
          <p className="text-body-sm text-ink-60">
            Total{" "}
            <span className="font-display text-h3 font-bold text-ink tabular-nums" data-testid="request-total">
              {formatMoney(request.total_snapshot_minor, request.currency)}
            </span>
          </p>
        </div>
        <ul className="divide-y divide-divider rounded-card border border-divider bg-paper-raised">
          {request.participants.map((participant) => (
            <li key={participant.request_participant_id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="request-participant">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body font-semibold text-ink">{participantName(participant)}</p>
                  <KindBadge kind={participant.participant_kind} />
                </div>
                <p className="mt-0.5 text-body-sm text-ink-80">
                  {participant.modality.name}
                  {participant.category ? ` · ${participant.category.name}` : ""}
                  {participant.kit_selection ? ` · Kit ${participant.kit_selection.label}` : ""}
                </p>
                {pending ? (
                  <p className="mt-1 text-body-sm">
                    {participant.legal_acceptance_status === "ACCEPTED" ? (
                      <span className="text-success">Documentos aceptados</span>
                    ) : (
                      <span className="text-warning">
                        {participant.is_buyer ? "Te falta aceptar los documentos (ve a tu Resumen)" : `Pendiente de aceptación de ${participantName(participant)}`}
                      </span>
                    )}
                  </p>
                ) : null}
                {participant.registration ? (
                  <p className="mt-1 text-body-sm text-ink-60">
                    Inscripción <span className="font-semibold text-ink tabular-nums">{participant.registration.registration_number}</span>
                    {participant.registration.participant_pass_id && (participant.is_buyer || participant.participant_kind === "GUEST") ? (
                      <>
                        {" · "}
                        <Link href={`/cuenta/pases/${participant.registration.participant_pass_id}`} className="font-semibold text-ink underline underline-offset-4">
                          Ver pase
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <p className="text-body font-semibold text-ink tabular-nums sm:text-right">{formatMoney(participant.price_snapshot_minor, request.currency)}</p>
            </li>
          ))}
        </ul>
      </section>

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

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="¿Cancelar esta solicitud?"
        description={`Se liberan de inmediato los lugares de ${pluralize(request.participants.length, "participante", "participantes")}. No se puede deshacer. Si ya acordaste algo con el organizador, avísale por WhatsApp.`}
        confirmLabel="Sí, cancelar solicitud"
        onConfirm={cancel}
        describeFailure={cancelFailure}
      >
        <FormField id="cancel-reason" label="Motivo (opcional)" helperText="Lo verá el organizador.">
          <textarea
            id="cancel-reason"
            value={reason}
            maxLength={500}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="cancel-reason-helper"
            className="w-full rounded-control border border-control bg-paper-raised px-4 py-3 text-body text-ink hover:border-ink-60 focus-visible:border-ink"
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}
