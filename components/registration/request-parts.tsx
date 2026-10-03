"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, MessageCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CountdownStatus } from "@/components/ui/countdown-status";
import { toast } from "@/components/ui/use-toast";
import { ConfirmDialog } from "@/components/account/confirm-dialog";
import { KindBadge } from "@/components/account/section";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import { formatMoney, pluralize } from "@/lib/client/account-format";
import type { RequestParticipantView, RequestView } from "@/lib/client/account-types";
import { effectiveRequestStatus, type RequestStatus } from "@/lib/shared/registration";

/**
 * Pieces of a registration request that /inscripcion (RequestOutcome) and the account (/cuenta/solicitudes)
 * render the same way (P2-C / P2-D): live effective status, the hold panel with the server countdown and the
 * wa.me handoff, the expired / canceled next step, the participants list, the REQUEST / HOLD / REGISTRATION
 * stages and cancel. Nothing here decides anything: every value comes from the server's request view.
 */

/** Live status of one request: the server's effective status (also derived from expires_at against the server's
 * own clock, whether or not the worker materialised the expiry), flipped to EXPIRED by the countdown itself. */
export function useLiveRequestStatus(request: Pick<RequestView, "effective_status" | "expires_at" | "server_time">): [RequestStatus, () => void] {
  const [expired, setExpired] = React.useState(false);
  const derived = effectiveRequestStatus(request.effective_status, request.expires_at, new Date(request.server_time));
  const status: RequestStatus = expired && derived === "PENDING_CONFIRMATION" ? "EXPIRED" : derived;
  return [status, () => setExpired(true)];
}

export function participantLabel(participant: Pick<RequestParticipantView, "is_buyer" | "display_name" | "participant_kind">): string {
  if (participant.is_buyer) return "Tú";
  return participant.display_name ?? (participant.participant_kind === "GUEST" ? "Invitado" : "Participante");
}

export function WhatsAppButton({
  href,
  size = "md",
  className,
  label = "Completar por WhatsApp",
  testId,
}: {
  href: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
  testId?: string;
}) {
  return (
    <Button asChild size={size} className={className}>
      <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
        <MessageCircle className="size-4" aria-hidden="true" />
        {label}
        <span className="sr-only"> (se abre en una pestaña nueva)</span>
      </a>
    </Button>
  );
}

/** HOLD: the absolute countdown from the server's expires_at + server_time, the server-built wa.me and the honest note. */
export function HoldPanel({
  request,
  onExpire,
  whatsappLabel,
  whatsappTestId,
  testId,
}: {
  request: Pick<RequestView, "expires_at" | "server_time" | "whatsapp_url">;
  onExpire: () => void;
  whatsappLabel?: string;
  whatsappTestId?: string;
  testId?: string;
}) {
  if (!request.expires_at) return null;
  return (
    <section aria-label="Apartado" className="flex flex-col gap-5 rounded-panel border border-divider bg-paper-raised p-5 md:flex-row md:items-end md:justify-between md:p-6" data-testid={testId}>
      <CountdownStatus label="El apartado vence en" expiresAt={request.expires_at} serverNow={request.server_time} onExpire={onExpire} />
      <div className="flex flex-col gap-2 md:items-end">
        {request.whatsapp_url ? <WhatsAppButton href={request.whatsapp_url} size="lg" className="w-full md:w-auto" label={whatsappLabel} testId={whatsappTestId} /> : null}
        <p className="text-caption text-ink-60">Apartar no es pagar: el organizador confirma tu inscripción. El tiempo no se extiende por abrir WhatsApp ni por recargar esta página.</p>
      </div>
    </section>
  );
}

/** Expired hold: the place is not restored; the next step is a new request (never "retry the old one").
 * `restart="link"` (account views) links to /inscripcion/:slug; `"none"` when the caller already offers its own button. */
export function ExpiredNotice({ request, restart = "link" }: { request: Pick<RequestView, "edition">; restart?: "link" | "none" }) {
  return (
    <Alert
      tone="warning"
      title="El apartado venció"
      action={
        <span className="flex flex-col gap-1 sm:items-end">
          {restart === "link" ? (
            <Link href={`/inscripcion/${request.edition.slug}`} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-ink underline underline-offset-4">
              Hacer una nueva solicitud
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
          <Link href={`/eventos/${request.edition.slug}`} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-ink-80 underline underline-offset-4">
            Ir a la página del evento
          </Link>
        </span>
      }
    >
      Los lugares se liberaron y esta solicitud ya no puede confirmarse. El lugar anterior no se restaura: empieza una solicitud nueva, sujeta al cupo que haya en ese momento.
    </Alert>
  );
}

const STAGE_TONE = { done: "text-success", current: "text-warning", open: "text-ink-60", lost: "text-danger" } as const;
type StageState = keyof typeof STAGE_TONE;
type Stage = { key: string; label: string; state: StageState; detail: string };

/** The three things a participant must not confuse: REQUEST (what they sent), HOLD (the temporary place, WhatsApp only)
 * and REGISTRATION (the confirmed inscription). FREE has no hold. */
export function requestStages(status: RequestStatus, mode: RequestView["registration_mode"]): Stage[] {
  const request: Stage = {
    key: "request",
    label: "Solicitud",
    state: "done",
    detail: status === "CANCELED_BY_BUYER" ? "Cancelada por ti" : status === "CANCELED_BY_STAFF" ? "Cancelada por el organizador" : "Enviada",
  };
  const registration = (state: StageState, detail: string): Stage => ({ key: "registration", label: "Inscripción", state, detail });
  const ended = status === "EXPIRED" || status === "CANCELED_BY_BUYER" || status === "CANCELED_BY_STAFF";

  if (mode === "FREE") {
    return [request, status === "CONFIRMED" ? registration("done", "Lista al instante, sin pago") : registration(ended ? "lost" : "open", ended ? "No se creó" : "En proceso")];
  }
  const hold: Stage = {
    key: "hold",
    label: "Apartado",
    state: status === "PENDING_CONFIRMATION" ? "current" : status === "CONFIRMED" ? "done" : "lost",
    detail: status === "PENDING_CONFIRMATION" ? "Lugares guardados por tiempo limitado" : status === "CONFIRMED" ? "Cumplido" : status === "EXPIRED" ? "Venció y se liberaron los lugares" : "Liberado",
  };
  return [request, hold, status === "CONFIRMED" ? registration("done", "Confirmada por el organizador") : registration(ended ? "lost" : "open", ended ? "No se creó" : "Aún no: la confirma el organizador")];
}

export function RequestStages({ status, mode }: { status: RequestStatus; mode: RequestView["registration_mode"] }) {
  const stages = requestStages(status, mode);
  return (
    <ol aria-label="Etapas de tu inscripción" className="grid gap-3 rounded-card border border-divider bg-paper-raised p-4 sm:p-5 md:grid-flow-col md:auto-cols-fr" data-testid="request-stages">
      {stages.map((stage, index) => (
        <li key={stage.key} className="flex flex-col gap-0.5" data-stage={stage.key} data-state={stage.state}>
          <span className="text-caption font-semibold text-ink-60">
            {index + 1}. {stage.label}
          </span>
          <span className={`text-body-sm font-semibold ${STAGE_TONE[stage.state]}`}>{stage.detail}</span>
        </li>
      ))}
    </ol>
  );
}

/** Participants of the request: who, what, the price snapshot, document acceptance and (once confirmed) the registration + pass link. */
export function RequestParticipants({
  request,
  status,
  testIds = { item: "request-participant", total: "request-total" },
}: {
  request: Pick<RequestView, "participants" | "currency" | "total_snapshot_minor">;
  status: RequestStatus;
  testIds?: { item: string; total: string };
}) {
  const pending = status === "PENDING_CONFIRMATION";
  return (
    <section aria-labelledby="request-participants-heading" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 border-b border-divider pb-3">
        <h3 id="request-participants-heading" className="text-h4 font-bold text-ink">
          {pluralize(request.participants.length, "participante", "participantes")}
        </h3>
        <p className="text-body-sm text-ink-60">
          Total{" "}
          <span className="font-display text-h3 font-bold text-ink tabular-nums" data-testid={testIds.total}>
            {formatMoney(request.total_snapshot_minor, request.currency)}
          </span>
        </p>
      </div>
      <ul className="divide-y divide-divider rounded-card border border-divider bg-paper-raised">
        {request.participants.map((participant) => {
          const name = participantLabel(participant);
          return (
            <li key={participant.request_participant_id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid={testIds.item}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body font-semibold text-ink">{name}</p>
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
                    ) : participant.is_buyer ? (
                      <span className="text-warning">
                        Te falta aceptar los documentos.{" "}
                        <Link href="/cuenta#pendientes" className="font-semibold underline underline-offset-4">
                          Aceptarlos en Pendientes
                        </Link>
                      </span>
                    ) : (
                      <span className="text-warning">Pendiente de aceptación de {name}</span>
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
                        Ver pase<span className="sr-only"> de {name}</span>
                      </Link>
                    ) : (
                      <span>{participant.is_buyer ? "Tu pase se está preparando." : "Recibirá su pase en su propia cuenta."}</span>
                    )}
                  </p>
                ) : null}
              </div>
              <p className="text-body font-semibold text-ink tabular-nums sm:text-right">{formatMoney(participant.price_snapshot_minor, request.currency)}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function cancelFailure(failure: ApiFailure): string {
  if (failure.code === "CONFLICT" || failure.code === "REQUEST_EXPIRED" || failure.code === "RESOURCE_EXPIRED") {
    return "La solicitud ya cambió de estado (confirmada, cancelada o expirada). Cierra para ver su estado actual.";
  }
  return errorMessage(failure);
}

function looksLikeRequest(value: unknown): value is RequestView {
  return Boolean(value) && typeof value === "object" && typeof (value as { registration_request_id?: unknown }).registration_request_id === "string" && Array.isArray((value as { participants?: unknown }).participants);
}

/** Buyer cancel (POST /registration-requests/:id/cancel): one idempotency key per intent, reason optional. `onCanceled`
 * receives the server's view of the canceled request, or null when the response carried none. */
export function CancelRequestDialog({
  request,
  open,
  onOpenChange,
  onCanceled,
}: {
  request: Pick<RequestView, "registration_request_id" | "participants">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCanceled: (view: RequestView | null) => void;
}) {
  const [reason, setReason] = React.useState("");
  const key = React.useRef(newIdempotencyKey());
  const fieldId = `cancel-reason-${request.registration_request_id}`;

  async function cancel(): Promise<ApiFailure | null> {
    const trimmed = reason.trim();
    const result = await apiFetch<unknown>(`/api/v1/registration-requests/${request.registration_request_id}/cancel`, {
      method: "POST",
      body: trimmed ? { reason: trimmed } : {},
      idempotencyKey: key.current,
    });
    if (!result.ok) {
      key.current = newIdempotencyKey();
      return result;
    }
    toast({ tone: "info", title: "Solicitud cancelada", description: "Los lugares apartados se liberaron." });
    onCanceled(looksLikeRequest(result.data) ? result.data : null);
    return null;
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="¿Cancelar esta solicitud?"
      description={`Se liberan de inmediato los lugares de ${pluralize(request.participants.length, "participante", "participantes")}. No se puede deshacer. Si ya acordaste algo con el organizador, avísale por WhatsApp.`}
      confirmLabel="Sí, cancelar solicitud"
      onConfirm={cancel}
      describeFailure={cancelFailure}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-label font-semibold text-ink">
          Motivo (opcional)
        </label>
        <textarea
          id={fieldId}
          value={reason}
          maxLength={500}
          rows={3}
          aria-describedby={`${fieldId}-helper`}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-control border border-control bg-paper-raised px-4 py-3 text-body text-ink hover:border-ink-60 focus-visible:border-ink"
        />
        <p id={`${fieldId}-helper`} className="text-caption text-ink-60">
          Lo verá el organizador.
        </p>
      </div>
    </ConfirmDialog>
  );
}
