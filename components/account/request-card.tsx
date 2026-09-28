"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountdownStatus } from "@/components/ui/countdown-status";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney, pluralize } from "@/lib/client/account-format";
import type { RequestView } from "@/lib/client/account-types";
import { presentRequest } from "@/lib/client/request-status";
import type { RequestStatus } from "@/lib/shared/registration";

/** Live status of one request: the server's effective status, flipped to EXPIRED by the countdown itself. */
export function useLiveRequestStatus(request: Pick<RequestView, "effective_status">): [RequestStatus, () => void] {
  const [expired, setExpired] = React.useState(false);
  const status: RequestStatus = expired && request.effective_status === "PENDING_CONFIRMATION" ? "EXPIRED" : request.effective_status;
  return [status, () => setExpired(true)];
}

export function WhatsAppButton({ href, size = "md", className }: { href: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <Button asChild size={size} className={className}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="size-4" aria-hidden="true" />
        Completar por WhatsApp
        <span className="sr-only"> (se abre en una pestaña nueva)</span>
      </a>
    </Button>
  );
}

/** ui-spec §4.8 request card: pending first-class (countdown + WhatsApp), others as a quiet summary row. */
export function RequestCard({ request }: { request: RequestView }) {
  const [status, markExpired] = useLiveRequestStatus(request);
  const presentation = presentRequest(status, request.registration_mode);
  const pending = status === "PENDING_CONFIRMATION";
  const headingId = `request-${request.registration_request_id}`;

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-4 p-5 md:p-6" data-testid="request-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id={headingId} className="text-h4 font-bold text-ink">
            <Link href={`/cuenta/solicitudes/${request.registration_request_id}`} className="rounded-xs hover:underline hover:underline-offset-4">
              {request.edition.name}
            </Link>
          </h3>
          <p className="mt-1 text-body-sm text-ink-60">
            {pending ? (
              <>
                Referencia <span className="font-semibold text-ink tabular-nums">{request.public_reference}</span> ·{" "}
              </>
            ) : null}
            {pluralize(request.participants.length, "participante", "participantes")} · Total{" "}
            <span className="font-semibold text-ink tabular-nums">{formatMoney(request.total_snapshot_minor, request.currency)}</span>
          </p>
        </div>
        <StatusBadge state={presentation.badge} label={presentation.label} className="self-start" />
      </div>

      {pending && request.expires_at ? (
        <div className="flex flex-col gap-4 rounded-card bg-paper-sunken p-4 sm:flex-row sm:items-end sm:justify-between">
          <CountdownStatus
            label="El apartado vence en"
            expiresAt={request.expires_at}
            serverNow={request.server_time}
            onExpire={markExpired}
          />
          {request.whatsapp_url ? <WhatsAppButton href={request.whatsapp_url} className="w-full sm:w-auto" /> : null}
        </div>
      ) : (
        <p className="text-body-sm text-ink-80">{presentation.summary}</p>
      )}

      <Link
        href={`/cuenta/solicitudes/${request.registration_request_id}`}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-xs text-button font-semibold text-ink underline decoration-divider underline-offset-8 hover:decoration-ink"
      >
        Ver detalle<span className="sr-only"> de la solicitud para {request.edition.name}</span>
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </article>
  );
}
