"use client";

import React from "react";
import { ExternalLink, MessageCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/client/account-format";
import { DefinitionList } from "@/components/admin/panel";
import { AdminBadge } from "@/components/admin/status-badges";
import { formatDateTime } from "@/components/admin/format";
import { ExpiryCell } from "@/components/admin/requests/request-cells";
import { holdState, STATUS_SPEC, type QueueRequest } from "@/components/admin/requests/request-logic";
import type { RequestStatus } from "@/lib/shared/registration";

/**
 * Quick-look body of one request (T13 §4.12 row expansion): status and absolute expiry, the hold, the buyer's contact and WhatsApp
 * state, and EVERY participant with modality, price, legal acceptance and kit. Pending acceptances are spelled out because they block
 * the confirmation (LEGAL_ACCEPTANCE_REQUIRED). Nothing here says "paid": the staff decides that by confirming.
 */
export function RequestDetail({ request, effective, nowMs, timeZone }: { request: QueueRequest; effective: RequestStatus; nowMs: number; timeZone: string }) {
  const status = STATUS_SPEC[effective];
  const hold = holdState(effective, request);
  const pendingAcceptance = request.participants.filter((participant) => participant.legal_acceptance_status === "PENDING");
  const buyerWhatsApp = request.buyer ? `https://wa.me/${request.buyer.phone_e164.replace(/^\+/, "")}` : null;

  return (
    <div className="flex flex-col gap-4" data-testid="request-detail">
      <div className="flex flex-wrap items-center gap-2">
        <AdminBadge icon={status.icon} tone={status.tone}>
          {status.label}
        </AdminBadge>
        <span className="font-mono text-caption text-ink-60">{request.public_reference}</span>
      </div>

      {pendingAcceptance.length > 0 && (effective === "PENDING_CONFIRMATION" || effective === "EXPIRED") ? (
        <div className="rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink" data-testid="blocking-reasons">
          <p className="font-semibold">Bloquea la confirmación</p>
          <ul className="list-disc pl-5">
            {pendingAcceptance.map((participant) => (
              <li key={participant.request_participant_id}>
                Pendiente de aceptación de {participant.display_name ?? "un participante"}.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {effective === "EXPIRED" && request.status !== "CONFIRMED" ? (
        <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink">
          Para confirmarla el servidor revalida precio, cupo y aceptaciones. Si el precio cambió te lo mostrará antes de continuar.
        </p>
      ) : null}

      <DefinitionList
        columns={1}
        items={[
          { label: "Vencimiento efectivo", value: <ExpiryCell request={request} effective={effective} nowMs={nowMs} timeZone={timeZone} /> },
          { label: "Apartado", value: hold.label },
          { label: "Creada", value: formatDateTime(request.created_at, timeZone) },
          { label: "Total de la solicitud", value: <span className="tabular-nums">{formatMoney(request.total_snapshot_minor, request.currency)}</span> },
          ...(request.confirmed_at ? [{ label: "Confirmada", value: formatDateTime(request.confirmed_at, timeZone) }] : []),
          ...(request.canceled_at ? [{ label: "Cancelada", value: formatDateTime(request.canceled_at, timeZone) }] : []),
          ...(request.cancel_reason ? [{ label: "Motivo interno", value: request.cancel_reason }] : []),
          ...(request.revalidated_from_expired ? [{ label: "Confirmación", value: "Confirmada tras revalidar una solicitud expirada" }] : []),
        ]}
      />

      {request.buyer ? (
        <section aria-labelledby="request-buyer-title">
          <h3 id="request-buyer-title" className="text-body-sm font-bold text-ink">
            Comprador
          </h3>
          <DefinitionList
            columns={1}
            items={[
              { label: "Nombre", value: request.buyer.full_name },
              { label: "Teléfono", value: <span className="font-mono">{request.buyer.phone_e164}</span> },
              { label: "Cuenta", value: request.buyer.is_new_account ? "Cuenta nueva al hacer la solicitud" : "Establecida" },
            ]}
          />
          {buyerWhatsApp ? (
            <a
              href={buyerWhatsApp}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-2`}
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              Escribir al comprador por WhatsApp
              <ExternalLink className="size-3.5" aria-hidden="true" />
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="request-whatsapp-title">
        <h3 id="request-whatsapp-title" className="text-body-sm font-bold text-ink">
          WhatsApp de la edición
        </h3>
        <DefinitionList
          columns={1}
          items={[
            { label: "Número de la solicitud", value: request.whatsapp_phone_e164 ? <span className="font-mono">{request.whatsapp_phone_e164}</span> : "Sin número guardado" },
            { label: "Enlace de continuación", value: request.whatsapp_url ? "Disponible: el comprador lo ve en su cuenta" : "No disponible" },
          ]}
        />
      </section>

      <section aria-labelledby="request-participants-title">
        <h3 id="request-participants-title" className="text-body-sm font-bold text-ink">
          Participantes ({request.participants.length})
        </h3>
        <ul className="mt-1 divide-y divide-divider rounded-control border border-divider" data-testid="request-participants">
          {request.participants.map((participant) => (
            <li key={participant.request_participant_id} className="px-3 py-2 text-body-sm">
              <p className="font-semibold text-ink">
                {participant.display_name ?? "Sin nombre"}
                {participant.is_buyer ? <span className="font-normal text-ink-60"> · comprador</span> : null}
              </p>
              <p className="text-caption text-ink-60">
                {participant.participant_kind === "GUEST" ? "Invitado" : "Cuenta"} · {participant.modality.name}
                {participant.category ? ` · ${participant.category.name}` : ""} ·{" "}
                <span className="tabular-nums">{formatMoney(participant.price_snapshot_minor, request.currency)}</span>
              </p>
              <p className="text-caption text-ink-60">
                {participant.legal_acceptance_status === "ACCEPTED" ? "Términos aceptados" : "Términos pendientes de aceptar"}
                {participant.kit_selection ? ` · Kit: ${participant.kit_selection.label}` : ""}
                {participant.registration ? ` · Inscripción ${participant.registration.registration_number}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
