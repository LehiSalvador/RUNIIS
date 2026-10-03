"use client";

import React from "react";
import Link from "next/link";
import { Clock, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrCodeView } from "@/components/ui/qr-code-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { KindBadge } from "@/components/account/section";
import { passState } from "@/components/account/logic/pass-state";
import { cn } from "@/lib/client/cn";
import type { PassView } from "@/lib/client/account-types";
import { focusWhenDialogsClosed } from "@/lib/client/focus";

/**
 * Private QR render (POST, image/svg+xml, no-store). A fresh request on every open and retry: the
 * SVG is never cached or reused (ADR-001 A1-A3). Non-2xx -> rejection -> QrCodeView error state.
 */
export async function loadPassQr(passId: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/v1/me/passes/${encodeURIComponent(passId)}/render-qr`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/svg+xml")) {
    throw new Error(`render-qr ${response.status}`);
  }
  return response.blob();
}

export function holderLabel(pass: PassView): string {
  if (pass.participant.is_self) return "Tu pase";
  return `Pase de ${pass.participant.display_name ?? "tu invitado"}`;
}

/** Badge for a pass that is not valid (revoked / canceled / registration no longer confirmed) or whose code is being renewed; null while valid. */
export function PassStateBadge({ pass }: { pass: PassView }) {
  const state = passState(pass);
  if (state.kind === "VALID") return null;
  if (state.kind === "RENEWING") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-info-border bg-info-tint px-2.5 py-0.5 text-caption font-semibold text-info">
        <Clock className="size-3.5" aria-hidden="true" />
        {state.label}
      </span>
    );
  }
  return <StatusBadge state="CANCELED" label={state.label} />;
}

/** Calendar tile: the event date as a results-board numeral (Archivo Narrow). */
export function DateTile({ isoDate, className }: { isoDate: string | null; className?: string }) {
  if (!isoDate) {
    return (
      <div className={cn("flex size-16 shrink-0 flex-col items-center justify-center rounded-card border border-divider bg-paper text-center", className)}>
        <span className="text-caption font-semibold text-ink-60">Fecha</span>
        <span className="text-caption text-ink-60">por definir</span>
      </div>
    );
  }
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const month = new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return (
    <div className={cn("flex size-16 shrink-0 flex-col items-center justify-center rounded-card border border-divider bg-paper", className)}>
      <span className="font-display text-h3 leading-none font-bold text-ink tabular-nums">{d}</span>
      <span className="text-caption font-semibold uppercase text-ink-60">{month}</span>
    </div>
  );
}

export function PassRow({ pass, detailLink = true }: { pass: PassView; detailLink?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const state = passState(pass);
  const headingId = `pass-${pass.participant_pass_id}`;

  return (
    <li className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center" data-testid="pass-row" data-pass-state={state.kind} aria-labelledby={headingId}>
      <div className="flex min-w-0 flex-1 gap-4">
        <DateTile isoDate={pass.edition.event_date} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-body-lg font-bold text-ink">
              {detailLink ? (
                <Link href={`/cuenta/pases/${pass.participant_pass_id}`} className="rounded-xs hover:underline hover:underline-offset-4">
                  {pass.edition.name}
                </Link>
              ) : (
                pass.edition.name
              )}
            </h3>
            <PassStateBadge pass={pass} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-ink-80">
            <span className="font-semibold text-ink">{holderLabel(pass)}</span>
            <KindBadge kind={pass.participant.participant_kind} label={pass.participant.is_self ? "Tuyo" : "A tu cargo"} />
            <span>
              {pass.modality.name}
              {pass.category ? ` · ${pass.category.name}` : ""}
            </span>
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
            <div className="flex gap-1.5">
              <dt className="text-ink-60">Inscripción</dt>
              <dd className="font-semibold text-ink tabular-nums">{pass.registration.registration_number}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-ink-60">Código</dt>
              <dd className="font-semibold tracking-[0.06em] text-ink tabular-nums" data-testid="pass-public-code">
                {pass.public_code}
              </dd>
            </div>
          </dl>
          {state.kind === "RENEWING" ? <p className="mt-2 text-body-sm text-ink-60">{state.message}</p> : null}
        </div>
      </div>
      {state.canShowQr ? (
        <>
          <Button ref={trigger} variant="secondary" onClick={() => setOpen(true)} className="w-full sm:w-auto">
            <QrCode className="size-4" aria-hidden="true" />
            Ver código QR<span className="sr-only"> de {holderLabel(pass).toLowerCase()} para {pass.edition.name}</span>
          </Button>
          <QrCodeView
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) focusWhenDialogsClosed(trigger.current);
            }}
            publicCode={pass.public_code}
            title={`${holderLabel(pass)} · ${pass.edition.name}`}
            loadQr={(signal) => loadPassQr(pass.participant_pass_id, signal)}
          />
        </>
      ) : (
        <p className="text-body-sm text-ink-60 sm:max-w-48">Este pase ya no es válido para entrar.</p>
      )}
    </li>
  );
}

/** J3 step 3: replacement is staff-only; the end user only gets a support path. */
export function PassSupportNote() {
  return (
    <p className="text-body-sm text-ink-60">
      ¿Crees que alguien más vio tu código?{" "}
      <Link href="/contacto" className="font-semibold text-ink underline underline-offset-4">
        Contacta a soporte
      </Link>
      .
    </p>
  );
}
