"use client";

import React from "react";
import { RotateCw, ShieldX, TriangleAlert, WifiOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/cn";
import type { AdminErrorView } from "@/components/admin/errors";
import { OUTCOME_SPEC, outcomeDetail, type OutcomeTone, type ScanOperation } from "@/components/scanner/outcomes";
import type { ParticipantMinimal, ScanResult } from "@/components/scanner/scan-api";

/**
 * T13 §3.6 ScannerFeedback: a full-screen takeover on the scanner-feedback layer. Icon (64px), a large label and a tinted
 * background; the icon and text carry the meaning (never colour alone) and render on the first frame. Informational outcomes clear
 * on their own after a short dwell, outcomes that need the operator stay longer; "Continuar" always dismisses at once.
 *
 * Besides the 11 server outcomes it renders the shell states T13 names: a request that failed (network loss shows "sin conexión,
 * reintenta" and NEVER a valid state) and the blocked state after a guardian was rejected. The component never decides whether a
 * credential is good: it shows what the server said.
 */
export type FeedbackView =
  | { kind: "outcome"; result: ScanResult; operation: ScanOperation }
  | { kind: "failure"; error: AdminErrorView; retryable: boolean }
  | { kind: "guardian_blocked"; participant: ParticipantMinimal | null };

const TONE: Record<OutcomeTone, { surface: string; accent: string }> = {
  success: { surface: "bg-success-tint", accent: "text-success" },
  info: { surface: "bg-info-tint", accent: "text-info" },
  warning: { surface: "bg-warning-tint", accent: "text-warning" },
  danger: { surface: "bg-danger-tint", accent: "text-danger" },
};

type Presentation = {
  icon: LucideIcon;
  tone: OutcomeTone;
  label: string;
  detail: string | null;
  dwellMs: number;
  testId: string;
};

function present(view: FeedbackView): Presentation {
  if (view.kind === "outcome") {
    const spec = OUTCOME_SPEC[view.result.outcome];
    return {
      icon: spec.icon,
      tone: spec.tone,
      label: spec.label,
      detail: outcomeDetail(view.result.outcome, view.operation) ?? spec.action,
      dwellMs: spec.dwellMs,
      testId: `scan-outcome-${view.result.outcome}`,
    };
  }
  if (view.kind === "guardian_blocked") {
    return {
      icon: ShieldX,
      tone: "danger",
      label: "Verificación rechazada",
      detail: "El menor no puede hacer check-in sin la verificación del guardián. Envíalo a la mesa de atención.",
      dwellMs: 0,
      testId: "scan-guardian-blocked",
    };
  }
  const network = view.error.kind === "network" || view.error.kind === "provider";
  return {
    icon: network ? WifiOff : TriangleAlert,
    tone: network ? "danger" : "warning",
    label: network ? "Sin conexión, reintenta" : view.error.title,
    detail: network
      ? "No se registró nada y ningún código se acepta sin respuesta del servidor. Revisa tu conexión y reintenta."
      : view.error.message,
    dwellMs: 0,
    testId: network ? "scan-network-error" : "scan-request-error",
  };
}

export function ScannerFeedback({
  view,
  onDismiss,
  onRetry,
  panel,
}: {
  view: FeedbackView;
  onDismiss: () => void;
  onRetry?: () => void;
  /** The guardian dialog of T13 §3.6, shown on top of the feedback (not instead of it). */
  panel?: React.ReactNode;
}) {
  const presentation = present(view);
  const { icon: Icon, tone, label, detail, dwellMs, testId } = presentation;
  const headingId = React.useId();
  const detailId = React.useId();
  const dismissRef = React.useRef<HTMLButtonElement | null>(null);
  const onDismissRef = React.useRef(onDismiss);
  React.useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  const participant = view.kind === "outcome" ? view.result.participant : view.kind === "guardian_blocked" ? view.participant : null;
  const requestId = view.kind === "failure" ? view.error.requestId : null;
  const hasPanel = Boolean(panel);

  React.useEffect(() => {
    if (!hasPanel) dismissRef.current?.focus();
  }, [hasPanel, view]);

  React.useEffect(() => {
    if (dwellMs <= 0) return;
    const timer = window.setTimeout(() => onDismissRef.current(), dwellMs);
    return () => window.clearTimeout(timer);
  }, [dwellMs, view]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={headingId}
      aria-describedby={detailId}
      data-testid={testId}
      data-tone={tone}
      className={cn("flex h-full flex-col bg-paper text-ink", TONE[tone].surface)}
    >
      {/* With the guardian panel up this region shrinks and can scroll on a small phone: it is then a keyboard-reachable region (axe: scrollable-region-focusable). */}
      <div
        {...(hasPanel ? { tabIndex: 0, role: "region", "aria-labelledby": headingId } : {})}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-center outline-offset-[-2px]"
      >
        <Icon className={cn("size-16 shrink-0", TONE[tone].accent)} aria-hidden="true" />
        <h2 id={headingId} className={cn("font-display text-h3 font-bold sm:text-h2", TONE[tone].accent)}>
          {label}
        </h2>
        {detail ? (
          <p id={detailId} className="max-w-md text-body-lg text-ink">
            {detail}
          </p>
        ) : null}
        {participant ? <ParticipantSummary participant={participant} /> : null}
        {requestId ? <p className="text-caption text-ink-80">Referencia de soporte: {requestId}</p> : null}
      </div>

      {panel ? (
        <div className="max-h-[70dvh] overflow-y-auto rounded-t-panel border-t border-divider bg-paper-raised px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lg">{panel}</div>
      ) : (
        <div className="flex flex-col gap-2 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {view.kind === "failure" && view.retryable && onRetry ? (
            <Button size="lg" onClick={onRetry} className="h-16 w-full text-body-lg">
              <RotateCw className="size-5" aria-hidden="true" />
              Reintentar
            </Button>
          ) : null}
          <Button ref={dismissRef} size="lg" variant={view.kind === "failure" && view.retryable ? "secondary" : "primary"} onClick={onDismiss} className="h-16 w-full text-body-lg">
            Continuar
          </Button>
        </div>
      )}
    </div>
  );
}

function ParticipantSummary({ participant }: { participant: ParticipantMinimal }) {
  return (
    <div className="mt-1 w-full max-w-md rounded-card border border-divider bg-paper-raised px-4 py-3 text-left" data-testid="scan-participant">
      <p className="text-h4 font-bold text-ink">{participant.display_name ?? "Participante sin nombre"}</p>
      <p className="text-body-sm text-ink-80">
        Inscripción {participant.registration_number} · {participant.modality.name}
        {participant.category ? ` · ${participant.category.name}` : ""}
      </p>
      {participant.is_minor ? <p className="mt-1 text-body-sm font-semibold text-ink">Menor de edad</p> : null}
    </div>
  );
}
