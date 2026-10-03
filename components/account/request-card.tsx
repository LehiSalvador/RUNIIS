"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CountdownStatus } from "@/components/ui/countdown-status";
import { StatusBadge } from "@/components/ui/status-badge";
import { useLiveRequestStatus, WhatsAppButton } from "@/components/registration/request-parts";
import { formatMoney, pluralize } from "@/lib/client/account-format";
import type { RequestView } from "@/lib/client/account-types";
import { presentRequest } from "@/lib/client/request-status";

// Shared with /inscripcion's outcome view (components/registration/request-parts); re-exported for existing imports.
export { useLiveRequestStatus, WhatsAppButton };

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
      {status === "EXPIRED" ? (
        <p className="text-body-sm text-ink-80" data-testid="request-card-expired-next">
          El lugar anterior no se restaura.{" "}
          <Link href={`/inscripcion/${request.edition.slug}`} className="font-semibold text-ink underline underline-offset-4">
            Empezar una solicitud nueva<span className="sr-only"> para {request.edition.name}</span>
          </Link>
        </p>
      ) : null}

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
