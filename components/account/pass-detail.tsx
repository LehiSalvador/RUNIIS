"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QrCodeView } from "@/components/ui/qr-code-view";
import { Runline } from "@/components/ui/runline";
import { passState } from "@/components/account/logic/pass-state";
import { holderLabel, loadPassQr, PassStateBadge, PassSupportNote } from "@/components/account/pass-row";
import { Fact, KindBadge } from "@/components/account/section";
import { formatCalendarDate } from "@/lib/client/account-format";
import type { PassView } from "@/lib/client/account-types";
import { focusWhenDialogsClosed } from "@/lib/client/focus";

/**
 * ui-spec §3.4 ParticipantPassView (end-user): public code always visible as text, QR on demand, no replace action.
 * A revoked / canceled pass (or one whose registration is no longer confirmed) is shown as not valid and never offers a QR;
 * a pass whose credential was replaced says the previous QR no longer works (P2-AC-12).
 */
export function PassDetail({ pass }: { pass: PassView }) {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const state = passState(pass);

  return (
    <div className="flex max-w-[var(--container-reading)] flex-col gap-8">
      <Link href="/cuenta/pases" className="inline-flex min-h-11 items-center gap-1.5 self-start text-body-sm font-semibold text-ink-80 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Todos los pases
      </Link>

      <article data-pass-state={state.kind} className="rounded-panel border border-divider bg-paper-raised p-5 md:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={pass.participant.participant_kind} label={pass.participant.is_self ? "Tuyo" : "A tu cargo"} />
          <PassStateBadge pass={pass} />
        </div>
        <h2 className="mt-3 font-display text-h2 font-bold text-ink">{pass.edition.name}</h2>
        <Runline weight="strong" className="mt-2 w-24" />
        <p className="mt-3 text-body text-ink-80">{formatCalendarDate(pass.edition.event_date, "long")}</p>

        <dl className="mt-6 grid gap-5 border-t border-divider pt-5 sm:grid-cols-2">
          <Fact label="Titular">{holderLabel(pass)}</Fact>
          <Fact label="Modalidad">
            {pass.modality.name}
            {pass.category ? ` · ${pass.category.name}` : ""}
          </Fact>
          <Fact label="Número de inscripción">
            <span className="font-display text-h4 font-bold tabular-nums">{pass.registration.registration_number}</span>
          </Fact>
          <Fact label="Código público">
            <span className="text-h4 font-semibold tracking-[0.08em] tabular-nums" data-testid="pass-public-code">
              {pass.public_code}
            </span>
          </Fact>
        </dl>

        {state.canShowQr ? (
          <div className="mt-6 border-t border-divider pt-6">
            {state.kind === "RENEWING" ? (
              <p className="mb-4 text-body-sm text-ink-80" data-testid="pass-renewing">
                {state.message}
              </p>
            ) : null}
            <Button ref={trigger} size="lg" onClick={() => setOpen(true)} className="w-full sm:w-auto">
              <QrCode className="size-5" aria-hidden="true" />
              Ver código QR
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
          </div>
        ) : (
          <p className="mt-6 border-t border-divider pt-6 text-body text-ink-80" data-testid="pass-invalid">
            {state.message}
          </p>
        )}
      </article>
      <PassSupportNote />
    </div>
  );
}
