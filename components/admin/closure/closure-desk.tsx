"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, Lock, ShieldAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ApiFailure } from "@/lib/client/api";
import { closeEditionResultSchema, reopenEditionResultSchema, type AttendanceWorkspace } from "@/lib/shared/closure";
import { DefinitionList, Panel } from "@/components/admin/panel";
import { formatDateTime } from "@/components/admin/format";
import { formatStaffLabel } from "@/components/admin/staff-label";
import { PanelsSkeleton } from "@/components/admin/skeletons";
import { SimpleCommandDialog } from "@/components/admin/closure/command-modal";
import { ReadinessList } from "@/components/admin/closure/readiness-list";
import { OutcomeBanner, StageBadge, WorkspaceError, WorkspaceFreshness, type Outcome } from "@/components/admin/closure/desk-parts";
import { adminBase, useWorkspace } from "@/components/admin/closure/closure-api";
import {
  closeFix,
  closeView,
  creditSummary,
  plural,
  revisionText,
  stageOf,
  staleAfter,
  type HistoryEntry,
  type Stage,
} from "@/components/admin/closure/closure-logic";

type Dialog = "close" | "reopen" | null;

/**
 * Closure desk (T12 J5 steps 6-8). The readiness is the server's (ten conditions, recomputed on every read); the Edition can be closed only by
 * a GLOBAL ADMIN (Master section 145), so everyone else reads the state and sees why they cannot act. Closing creates the administrative closure and
 * the DistanceCredits in one transaction, exactly once; reopening it reverses the credits and keeps their history. The credit summary is what the
 * server reports (Guests are never credited); this screen never computes a credit.
 */
export function ClosureDesk({ editionId, timeZone, isGlobalAdmin }: { editionId: string; timeZone: string; isGlobalAdmin: boolean }) {
  const router = useRouter();
  const { state, refresh } = useWorkspace(editionId);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [lastClose, setLastClose] = React.useState<{ revision: number; credits: number } | null>(null);
  const [lastReversal, setLastReversal] = React.useState<number | null>(null);

  const onRefusal = React.useCallback(
    (failure: ApiFailure) => {
      if (staleAfter(failure)) {
        void refresh();
        router.refresh();
      }
    },
    [refresh, router],
  );
  const record = React.useCallback(
    (next: Outcome, entry: string) => {
      setOutcome(next);
      setHistory((current) => [{ at: new Date().toISOString(), text: entry }, ...current]);
      void refresh();
      router.refresh(); // the Edition's closure state badge in the page header is server rendered
    },
    [refresh, router],
  );

  if (state.status === "loading") {
    return (
      <div data-testid="desk-loading">
        <PanelsSkeleton count={3} label="Cargando el cierre" />
      </div>
    );
  }
  if (state.status === "error") return <WorkspaceError failure={state.failure} onRetry={() => void refresh()} title="No pudimos cargar el estado del cierre." />;

  const workspace = state.data;
  const stage = stageOf(workspace);
  const view = closeView(workspace, isGlobalAdmin);
  const credits = creditSummary(workspace);
  const closure = workspace.current_closure;
  const finalization = workspace.current_finalization;

  return (
    <div className="flex flex-col gap-4" data-testid="closure-desk" data-stage={stage}>
      {!isGlobalAdmin ? (
        <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" role="note" data-testid="global-only-note">
          <ShieldAlert className="mr-1.5 inline size-4 align-text-bottom" aria-hidden="true" />
          <strong>Cerrar y reabrir una edición es solo de un administrador global.</strong> Con tu acceso puedes ver la preparación y el resumen, pero no cerrar ni reabrir.
        </p>
      ) : null}

      {outcome ? <OutcomeBanner outcome={outcome} onDismiss={() => setOutcome(null)} /> : null}
      {state.refreshFailure ? <WorkspaceError failure={state.refreshFailure} onRetry={() => void refresh()} title="No pudimos actualizar: se muestran los datos anteriores." /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StageBadge stage={stage} />
        <WorkspaceFreshness loadedAt={state.loadedAt} refreshing={state.refreshing} onRefresh={() => void refresh()} timeZone={timeZone} />
      </div>

      <CycleSteps editionId={editionId} stage={stage} workspace={workspace} />

      <Panel
        title={stage === "CLOSED" ? "Cierre vigente" : "Preparación para cerrar"}
        description={
          stage === "CLOSED"
            ? "La edición está cerrada: los créditos de distancia ya se generaron."
            : "Las diez condiciones se recalculan en cada lectura. Completar las tareas por sí solo no basta."
        }
      >
        {stage === "CLOSED" && closure ? (
          <div className="flex flex-col gap-4" data-testid="closure-summary">
            <DefinitionList
              columns={3}
              items={[
                { label: "Revisión del cierre", value: `${closure.revision} · ${revisionText("closure", closure.revision)}` },
                { label: "Cerrada por", value: formatStaffLabel(closure.closed_by_staff_label, closure.closed_by_staff_id) ?? "Administrador global" },
                { label: "Cuándo", value: formatDateTime(closure.closed_at, timeZone) },
                { label: "Finalización asociada", value: finalization ? `Revisión ${finalization.revision}` : "—" },
                { label: "Créditos activos", value: <span data-testid="active-credits">{credits.credited}{credits.partial ? " (en la lista parcial)" : ""}</span> },
                ...(lastClose && lastClose.revision === closure.revision
                  ? [{ label: "Créditos creados en este cierre", value: <span data-testid="credits-created">{lastClose.credits}</span> }]
                  : []),
              ]}
            />
            {isGlobalAdmin ? (
              <div>
                <Button variant="danger" onClick={() => setDialog("reopen")} data-testid="reopen-closure-button">
                  Reabrir el cierre…
                </Button>
                <p className="mt-2 text-caption text-ink-60">Pide un motivo, revierte los créditos activos y conserva su historial.</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ReadinessList
              title="Condiciones de cierre"
              ready={view.ready}
              checks={workspace.close_readiness.checks.filter((check) => check.code !== "NOT_ALREADY_CLOSED")}
              fixFor={(code) => closeFix(editionId, code)}
              testId="close-readiness"
            />
            {isGlobalAdmin ? (
              <div className="flex flex-col gap-2 border-t border-divider pt-4" data-testid="close-bar">
                <div>
                  <Button onClick={() => setDialog("close")} disabled={!view.ready} aria-describedby="close-blocking" data-testid="close-button">
                    <Lock className="size-4" aria-hidden="true" />
                    Cerrar la edición…
                  </Button>
                </div>
                <p id="close-blocking" className="text-body-sm text-ink" data-testid="close-blocking">
                  {view.ready
                    ? "Todo está listo: al cerrar se generan los créditos de distancia."
                    : view.stage === "OPEN"
                      ? "No se puede cerrar: la asistencia todavía no está finalizada."
                      : `No se puede cerrar: ${plural(view.blockers.length, "condición pendiente", "condiciones pendientes")} (arriba, con su detalle).`}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="Créditos de distancia" description="Los calcula y guarda el servidor al cerrar. Esta pantalla solo los muestra.">
        <div className="flex flex-col gap-3" data-testid="credit-summary">
          <DefinitionList
            columns={3}
            items={[
              { label: "Con crédito activo", value: <span data-testid="credit-count">{credits.credited}</span> },
              { label: "Presentes con crédito permitido (cuenta de corredor)", value: <span data-testid="credit-candidates">{credits.candidates}</span> },
              { label: "Invitados con crédito", value: <span data-testid="credit-guests">{credits.guestsCredited}</span> },
            ]}
          />
          <p className="text-body-sm text-ink-80">
            Un invitado nunca recibe crédito. Reciben crédito los presentes con crédito permitido, con cuenta de corredor y en una modalidad que acredita distancia; el servidor aplica la distancia oficial
            de la modalidad.
          </p>
          {credits.byModality.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Créditos activos por modalidad" data-testid="credit-by-modality">
              {credits.byModality.map((item) => (
                <li key={item.name} className="rounded-full border border-control bg-paper-sunken px-3 py-1 text-caption font-semibold text-ink">
                  {item.name}: {item.count}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-ink-60">{stage === "CLOSED" ? "No hay créditos activos." : "Todavía no hay créditos: se crean al cerrar la edición."}</p>
          )}
          {credits.partial ? (
            <p className="text-caption text-warning" role="note">
              Las cifras por inscripción cubren solo la lista parcial que devolvió el servidor. {lastClose ? `El cierre creó ${lastClose.credits} créditos en total.` : ""}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel title="Historial de revisiones" description="Lo que el servidor reporta de la finalización y el cierre vigentes, y lo confirmado en esta sesión.">
        <div className="flex flex-col gap-3" data-testid="history">
          <ul className="flex flex-col gap-1.5 text-body-sm text-ink">
            <li data-testid="history-finalization">
              <strong>Finalización:</strong> {finalization ? `revisión ${finalization.revision}. ${revisionText("finalization", finalization.revision)}` : "no hay una vigente (la asistencia está abierta)."}
            </li>
            <li data-testid="history-closure">
              <strong>Cierre:</strong> {closure ? `revisión ${closure.revision}. ${revisionText("closure", closure.revision)}` : "no hay uno vigente."}
            </li>
            {lastReversal !== null ? (
              <li data-testid="history-reversal">
                <strong>Último cierre reabierto en esta sesión:</strong> se {lastReversal === 1 ? "revirtió 1 crédito" : `revirtieron ${lastReversal} créditos`}; su historial se conserva y el próximo cierre enlaza cada crédito nuevo con el revertido.
              </li>
            ) : null}
          </ul>
          {history.length > 0 ? (
            <ol className="flex flex-col gap-1 border-t border-divider pt-3 text-body-sm text-ink-80" aria-label="Confirmado por el servidor en esta sesión">
              {history.map((entry) => (
                <li key={entry.at}>
                  <span className="text-caption text-ink-60">{formatDateTime(entry.at, timeZone)}</span> · {entry.text}
                </li>
              ))}
            </ol>
          ) : null}
          <p className="text-caption text-ink-60">
            Las revisiones sustituidas y los créditos revertidos se conservan en la auditoría del servidor; todavía no hay una lectura que las liste aquí.
          </p>
        </div>
      </Panel>

      {dialog === "close" ? (
        <SimpleCommandDialog
          kind="close"
          title="Cerrar la edición"
          description="Crea el cierre administrativo y los créditos de distancia en una sola operación."
          confirmLabel="Cerrar la edición"
          path={`${adminBase(editionId)}/close`}
          schema={closeEditionResultSchema}
          buildBody={() => ({})}
          confirm={{ label: "Entiendo que se crearán los créditos de distancia y que la edición quedará cerrada." }}
          consequences={
            <ul className="list-disc space-y-1 pl-5">
              <li>El cierre y los créditos se crean juntos, exactamente una vez: reintentar o cerrar a la vez desde dos pantallas no duplica nada.</li>
              <li>
                Reciben crédito los presentes con crédito permitido, con cuenta de corredor y en una modalidad que acredita distancia (hasta <strong>{credits.candidates}</strong> ahora). Los invitados nunca reciben
                crédito.
              </li>
              <li>Después no se podrá cambiar la elegibilidad, cancelar, cambiar de modalidad ni reabrir la finalización, hasta que reabras el cierre.</li>
            </ul>
          }
          onRefusal={onRefusal}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            setLastClose({ revision: result.revision, credits: result.credits_created });
            setLastReversal(null);
            record(
              {
                tone: "success",
                title: "Edición cerrada",
                text: `Revisión ${result.revision} del cierre: se ${result.credits_created === 1 ? "creó 1 crédito" : `crearon ${result.credits_created} créditos`} de distancia (${formatDateTime(result.closed_at, timeZone)}).`,
              },
              `Cierre revisión ${result.revision}: ${result.credits_created} créditos creados.`,
            );
          }}
        />
      ) : null}
      {dialog === "reopen" ? (
        <SimpleCommandDialog
          kind="reopen_edition"
          title="Reabrir el cierre de la edición"
          description="Revierte los créditos de distancia y devuelve la edición a «finalizada»."
          confirmLabel="Reabrir el cierre"
          tone="danger"
          path={`${adminBase(editionId)}/reopen`}
          schema={reopenEditionResultSchema}
          buildBody={(reason) => ({ reason })}
          count={{ value: credits.credited, noun: credits.credited === 1 ? "crédito activo" : "créditos activos" }}
          reason={{ label: "Motivo de la reapertura", required: true, helper: "Obligatorio: queda en la auditoría." }}
          consequences={
            <ul className="list-disc space-y-1 pl-5">
              <li>Se revierten todos los créditos activos de la edición. Su historial se conserva: el próximo cierre crea créditos nuevos enlazados a los revertidos.</li>
              <li>Los periodos de ranking que incluyan esta edición dejarán de contar esos créditos hasta el nuevo cierre, y el cierre nuevo será una revisión distinta.</li>
              <li>La finalización de asistencia sigue vigente. Para corregir asistencia, reabre después la finalización desde Asistencia.</li>
            </ul>
          }
          onRefusal={onRefusal}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            setLastReversal(result.reversed_credit_count);
            setLastClose(null);
            record(
              {
                tone: "info",
                title: "Cierre reabierto",
                text: `Se ${result.reversed_credit_count === 1 ? "revirtió 1 crédito" : `revirtieron ${result.reversed_credit_count} créditos`} de distancia. La edición volvió a «finalizada».`,
              },
              `Cierre reabierto: ${result.reversed_credit_count} créditos revertidos.`,
            );
          }}
        />
      ) : null}
    </div>
  );
}

function CycleSteps({ editionId, stage, workspace }: { editionId: string; stage: Stage; workspace: AttendanceWorkspace }) {
  const steps: { key: string; label: string; detail: string; done: boolean; href?: string }[] = [
    {
      key: "attendance",
      label: "Resolver la asistencia",
      detail: `${workspace.attendance_counts.PENDING ?? 0} pendientes de ${workspace.universe_count}`,
      done: stage !== "OPEN",
      href: `/admin/eventos/${editionId}/asistencia`,
    },
    {
      key: "finalize",
      label: "Finalizar la asistencia",
      detail: workspace.current_finalization ? `Revisión ${workspace.current_finalization.revision}` : "Aún no finalizada",
      done: stage !== "OPEN",
    },
    {
      key: "close",
      label: "Cerrar la edición",
      detail: workspace.current_closure ? `Revisión ${workspace.current_closure.revision}` : "Aún abierta",
      done: stage === "CLOSED",
    },
  ];
  // "Current" is the first step that is not done yet.
  const firstPending = steps.findIndex((step) => !step.done);
  return (
    <ol className="grid gap-3 sm:grid-cols-3" aria-label="Pasos del ciclo de cierre" data-testid="cycle-steps">
      {steps.map((step, index) => {
        const current = index === firstPending;
        return (
          <li
            key={step.key}
            aria-current={current ? "step" : undefined}
            className={`flex items-start gap-2 rounded-card border p-3 ${current ? "border-ink bg-paper-sunken" : "border-divider bg-paper-raised"}`}
          >
            {step.done ? (
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-control text-caption font-semibold text-ink-80" aria-hidden="true">
                {index + 1}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-ink">
                {step.label}
                <span className="sr-only">{step.done ? " (hecho)" : current ? " (paso actual)" : " (pendiente)"}</span>
              </p>
              <p className="text-caption text-ink-60">{step.detail}</p>
              {step.href && current ? (
                <Link href={step.href} prefetch={false} className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-2`}>
                  Ir a Asistencia
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
