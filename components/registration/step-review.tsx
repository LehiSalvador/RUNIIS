"use client";

import React from "react";
import { Clock, Pencil, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CountdownStatus } from "@/components/ui/countdown-status";
import { formatDateTime, formatMoney, pluralize } from "@/lib/client/account-format";
import type { RegistrationContext } from "@/lib/shared/registration-context";
import { candidateName, RelationBadge, StepHeading } from "./bits";
import {
  categoryChoices,
  derivedCategoryName,
  ensureParticipant,
  estimateTotal,
  legalRows,
  modalityOf,
  orderedSelection,
  type Draft,
  type StepId,
} from "./logic/model";

/**
 * Step 4 (ux-spec J1 step 5): a read-only recap of every choice with edit-back links, the display-only price
 * estimate and what submitting does in THIS edition's mode. The server snapshot, not this screen, is the price
 * and the hold; one atomic submit shows every failing row at once.
 */
export function StepReview({
  ctx,
  draft,
  headingRef,
  submitting,
  retryAt,
  onRetryReady,
  blockedReason,
  captchaPanel,
  captchaBlocked = false,
  captchaPhase,
  onEdit,
  onSubmit,
}: {
  ctx: RegistrationContext;
  draft: Draft;
  headingRef: React.Ref<HTMLHeadingElement>;
  submitting: boolean;
  retryAt: string | null;
  onRetryReady: () => void;
  blockedReason: string | null;
  /** OD-P2-01 anti-hoarding panel (renders nothing unless the server asked for a challenge) and whether it holds the submit back. */
  captchaPanel?: React.ReactNode;
  captchaBlocked?: boolean;
  /** Phase of the challenge, exposed on the submit button so a stuck submit is diagnosable (tests, support) without a visible panel. */
  captchaPhase?: string;
  onEdit: (step: StepId) => void;
  onSubmit: () => void;
}) {
  const selection = orderedSelection(ctx, draft);
  const total = estimateTotal(ctx, draft);
  const rows = legalRows(ctx, draft);
  const whatsapp = ctx.edition.registration_mode === "EXTERNAL_WHATSAPP";
  const free = !whatsapp;
  const rateLimited = retryAt !== null;

  return (
    <section aria-labelledby="step-review-heading" className="flex flex-col gap-5">
      <StepHeading id="step-review-heading" ref={headingRef} title="Revisa y envía" lead="Confirma que todo esté bien. Nada se envía hasta que presiones el botón al final." />

      <ul className="divide-y divide-divider rounded-card border border-divider bg-paper-raised" aria-label="Resumen de participantes" data-testid="review-list">
        {selection.map((candidate) => {
          const participant = ensureParticipant(draft, candidate.candidate_key);
          const modality = modalityOf(ctx, participant.modalityId);
          const categoryName =
            categoryChoices(ctx, candidate, participant.modalityId ?? "").find((choice) => choice.category_id === participant.categoryId)?.name ??
            (participant.modalityId ? derivedCategoryName(ctx, candidate, participant.modalityId) : null);
          const row = rows.find((item) => item.candidate.candidate_key === candidate.candidate_key);
          const ticking = row?.documents.filter((doc) => doc.missing && doc.checked).length ?? 0;
          return (
            <li key={candidate.candidate_key} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="review-row">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-body font-semibold text-ink">{candidateName(candidate)}</p>
                  <RelationBadge candidate={candidate} />
                </div>
                <p className="mt-0.5 text-body-sm text-ink-80">
                  {modality?.name ?? "Sin modalidad"}
                  {categoryName ? ` · ${categoryName}` : ""}
                </p>
                <p className="mt-1 text-body-sm">
                  {row?.pendingOther ? (
                    <span className="text-warning">Pendiente de aceptación de {candidate.display_name ?? "esta persona"}</span>
                  ) : ticking > 0 ? (
                    <span className="text-ink-80">Aceptarás los documentos del evento al enviar</span>
                  ) : (
                    <span className="text-success">Documentos del evento aceptados</span>
                  )}
                </p>
              </div>
              <p className="text-body font-semibold text-ink tabular-nums sm:text-right">
                {modality?.price ? formatMoney(modality.price.amount_minor, modality.price.currency) : "Precio por confirmar"}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => onEdit("participants")}>
          <Pencil className="size-4" aria-hidden="true" />
          Cambiar participantes
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onEdit("details")}>
          <Pencil className="size-4" aria-hidden="true" />
          Cambiar modalidad y datos
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onEdit("legal")}>
          <Pencil className="size-4" aria-hidden="true" />
          Ver documentos
        </Button>
      </div>

      <div className="flex items-end justify-between gap-4 border-t border-divider pt-4">
        <div>
          <p className="text-body-sm text-ink-60">{pluralize(selection.length, "participante", "participantes")}</p>
          <p className="text-body-sm text-ink-60">Total estimado</p>
        </div>
        <p className="font-display text-h2 font-bold text-ink tabular-nums" data-testid="review-total">
          {total ? formatMoney(total.amountMinor, total.currency) : "Por confirmar"}
        </p>
      </div>
      <p className="text-caption text-ink-60">El precio final lo fija el servidor al enviar y se muestra en tu confirmación.</p>

      {whatsapp ? (
        <Alert tone="info" title="Esto aparta tus lugares, no es un pago">
          Al enviar, apartamos tus lugares
          {ctx.hold ? (
            <>
              {" "}
              hasta <strong className="text-ink">{formatDateTime(ctx.hold.projected_expires_at)}</strong> ({Math.round(ctx.hold.duration_minutes / 60)} horas como máximo, sin prórrogas)
            </>
          ) : null}
          . Después escribes al organizador por WhatsApp para completar tu inscripción. Si el tiempo se acaba, los lugares se liberan. El vencimiento exacto aparece al enviar.
        </Alert>
      ) : (
        <Alert tone="success" title="Se confirma al instante">
          Este evento es gratuito: al enviar, tu inscripción queda confirmada y cada persona tendrá su propio pase. No hay apartado ni pago.
        </Alert>
      )}

      {blockedReason ? (
        <Alert tone="warning" title="Todavía no puedes enviar">
          {blockedReason}
        </Alert>
      ) : null}

      {rateLimited ? (
        <div className="flex flex-col gap-1 rounded-card border border-warning-border bg-warning-tint p-4">
          <CountdownStatus variant="compact" label="Podrás intentar de nuevo en" expiresAt={retryAt} onExpire={onRetryReady} />
          <p className="text-caption text-ink-60">Por seguridad limitamos los envíos por persona.</p>
        </div>
      ) : null}

      {captchaPanel}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button size="lg" onClick={onSubmit} loading={submitting} disabled={Boolean(blockedReason) || rateLimited || captchaBlocked} data-captcha-state={captchaPhase} className="w-full sm:w-auto sm:min-w-64">
          {free ? <ShieldCheck className="size-5" aria-hidden="true" /> : <Clock className="size-5" aria-hidden="true" />}
          {free ? "Confirmar inscripción" : "Apartar mis lugares"}
        </Button>
      </div>
    </section>
  );
}
