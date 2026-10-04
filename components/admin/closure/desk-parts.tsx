"use client";

import React from "react";
import { CircleCheck, Clock, Lock, RotateCw, Unlock } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ApiFailure } from "@/lib/client/api";
import { ErrorNoticeView } from "@/components/admin/error-notice";
import { describeFailure } from "@/components/admin/errors";
import { AdminBadge } from "@/components/admin/status-badges";
import type { Stage } from "@/components/admin/closure/closure-logic";

/** What the server confirmed, shown after a command (never before the answer arrives). */
export type Outcome = { tone: "success" | "info"; title: string; text: string };

export function OutcomeBanner({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }) {
  return (
    <div data-testid="command-outcome">
      <Alert tone={outcome.tone} title={outcome.title} dismissible onDismiss={onDismiss}>
        <p>{outcome.text}</p>
      </Alert>
    </div>
  );
}

const STAGE_TEXT: Record<Stage, string> = {
  OPEN: "Asistencia abierta",
  FINALIZED: "Asistencia finalizada",
  CLOSED: "Edición cerrada",
};

export function StageBadge({ stage }: { stage: Stage }) {
  const icon = stage === "OPEN" ? Unlock : stage === "FINALIZED" ? CircleCheck : Lock;
  return (
    <span data-testid="stage-badge" data-stage={stage}>
      <AdminBadge icon={icon} tone={stage === "OPEN" ? "info" : stage === "FINALIZED" ? "success" : "neutral"}>
        {STAGE_TEXT[stage]}
      </AdminBadge>
    </span>
  );
}

/**
 * When the workspace was read, with a manual refresh. The workspace is a writing call (it reconciles the universe), so there is no polling:
 * the desk reads it when it opens, after every confirmed command and when the operator asks. After five minutes the line warns that the data
 * may have changed.
 */
export function WorkspaceFreshness({
  loadedAt,
  refreshing,
  onRefresh,
  timeZone,
}: {
  loadedAt: string;
  refreshing: boolean;
  onRefresh: () => void;
  timeZone: string;
}) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [loadedAt]);
  const loaded = new Date(loadedAt);
  const stale = now !== null && now - loaded.getTime() > 5 * 60_000;
  const time = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(loaded);
  return (
    <div className={`flex flex-wrap items-center gap-2 text-caption ${stale ? "text-warning" : "text-ink-60"}`} data-stale={stale ? "true" : "false"} data-testid="freshness">
      <Clock className="size-3.5" aria-hidden="true" />
      <span role={stale ? "status" : undefined}>{stale ? `Datos de las ${time}: pueden haber cambiado.` : `Actualizado a las ${time}`}</span>
      <Button variant="ghost" size="sm" loading={refreshing} onClick={onRefresh}>
        <RotateCw className="size-4" aria-hidden="true" />
        Actualizar
      </Button>
    </div>
  );
}

/** The workspace could not be read: the shared actionable error with the reference, and a retry that reads it again. */
export function WorkspaceError({ failure, onRetry, title }: { failure: ApiFailure; onRetry: () => void; title: string }) {
  return (
    <div data-testid="workspace-error">
      <ErrorNoticeView view={{ ...describeFailure(failure), action: failure.code === "AUTH_REQUIRED" ? "signin" : failure.code === "FORBIDDEN" || failure.code === "NOT_FOUND" ? "none" : "retry" }} onRetry={onRetry} title={title} />
    </div>
  );
}
