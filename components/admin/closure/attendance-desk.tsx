"use client";

import React from "react";
import Link from "next/link";
import { Ban, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Hourglass, ScanLine, ShieldAlert, UserX, Users, type LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { SearchInput } from "@/components/ui/search-input";
import type { ApiFailure } from "@/lib/client/api";
import {
  attendanceFinalizationSchema,
  reopenFinalizationResultSchema,
  type AttendanceFinalization,
  type AttendanceWorkspace,
  type AttendanceWorkspaceParticipant,
} from "@/lib/shared/closure";
import { SelectField } from "@/components/admin/events/fields";
import { DefinitionList, Panel } from "@/components/admin/panel";
import { AdminBadge, type BadgeTone } from "@/components/admin/status-badges";
import { formatDateTime } from "@/components/admin/format";
import { formatStaffLabel } from "@/components/admin/staff-label";
import { PanelsSkeleton, TableSkeleton } from "@/components/admin/skeletons";
import { SimpleCommandDialog } from "@/components/admin/closure/command-modal";
import { ResolveAttendanceDialog, ResolveEligibilityDialog } from "@/components/admin/closure/resolve-dialogs";
import { ReadinessList } from "@/components/admin/closure/readiness-list";
import { OutcomeBanner, StageBadge, WorkspaceError, WorkspaceFreshness, type Outcome } from "@/components/admin/closure/desk-parts";
import { adminBase, useWorkspace } from "@/components/admin/closure/closure-api";
import {
  ATTENDANCE_LABEL,
  ATTENDANCE_ORDER,
  DEFAULT_PAGE_SIZE,
  DISPOSITION_LABEL,
  ELIGIBILITY_LABEL,
  EMPTY_FILTERS,
  GUARDIAN_LABEL,
  KIND_LABEL,
  PAGE_SIZES,
  SOURCE_LABEL,
  canResolveAttendance,
  canResolveEligibility,
  displayName,
  filterRows,
  finalizeBlockingText,
  finalizeView,
  hasActiveFilters,
  paginate,
  plural,
  revisionText,
  stageOf,
  staleAfter,
  truncationText,
  type AttendanceStatus,
  type DeskFilters,
  type EligibilityStatus,
} from "@/components/admin/closure/closure-logic";

type Dialog =
  | { kind: "attendance"; row: AttendanceWorkspaceParticipant }
  | { kind: "eligibility"; row: AttendanceWorkspaceParticipant }
  | { kind: "finalize" }
  | { kind: "bulk" }
  | { kind: "reopen" };

/**
 * Attendance desk (T13 4.14, T12 J5). The universe is every CONFIRMED registration; each row carries its attendance and, separately, its
 * sporting eligibility. Check-in is evidence, never final attendance: the server pre-classifies it and the desk says so. Counts, readiness and the
 * blocking list are the server's; commands are explicit (reason, evidence, scope confirmation) and the screen reads the workspace again after each.
 */
export function AttendanceDesk({
  editionId,
  timeZone,
  canOpenClosure,
}: {
  editionId: string;
  timeZone: string;
  /** The viewer may open the closure page (an ADMIN of this Edition): the link is only a convenience, the page re-checks. */
  canOpenClosure: boolean;
}) {
  const { state, refresh } = useWorkspace(editionId);
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [filters, setFilters] = React.useState<DeskFilters>(EMPTY_FILTERS);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);

  const onRefusal = React.useCallback(
    (failure: ApiFailure) => {
      if (staleAfter(failure)) void refresh();
    },
    [refresh],
  );
  const done = React.useCallback(
    (next: Outcome) => {
      setOutcome(next);
      void refresh();
    },
    [refresh],
  );

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4" data-testid="desk-loading">
        <PanelsSkeleton count={2} label="Cargando la asistencia" />
        <TableSkeleton rows={6} columns={5} label="Cargando inscripciones" />
      </div>
    );
  }
  if (state.status === "error") return <WorkspaceError failure={state.failure} onRetry={() => void refresh()} title="No pudimos cargar la asistencia." />;

  const workspace = state.data;
  const stage = stageOf(workspace);
  const view = finalizeView(workspace);
  const truncated = truncationText(workspace);
  const filtered = filterRows(workspace.participants, filters);
  const shown = paginate(filtered, page, pageSize);
  const modalities = uniqueModalities(workspace.participants);

  const patchFilters = (patch: Partial<DeskFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="attendance-desk" data-stage={stage}>
      <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" role="note" data-testid="evidence-note">
        <ScanLine className="mr-1.5 inline size-4 align-text-bottom" aria-hidden="true" />
        <strong>El check-in es evidencia de llegada, no la asistencia final.</strong> El servidor preclasifica como presente a quien hizo check-in y deja pendiente a quien no.
        Un pendiente nunca significa que no se presentó hasta que lo resuelvas.
      </p>

      {outcome ? <OutcomeBanner outcome={outcome} onDismiss={() => setOutcome(null)} /> : null}
      {state.refreshFailure ? <WorkspaceError failure={state.refreshFailure} onRetry={() => void refresh()} title="No pudimos actualizar: se muestran los datos anteriores." /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StageBadge stage={stage} />
        <WorkspaceFreshness loadedAt={state.loadedAt} refreshing={state.refreshing} onRefresh={() => void refresh()} timeZone={timeZone} />
      </div>

      <StatRow workspace={workspace} filters={filters} onFilter={(status) => patchFilters({ status })} />

      {truncated ? (
        <p className="rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink" role="note" data-testid="truncation-note">
          <strong>Lista parcial.</strong> {truncated}{" "}
          <Link href={`/admin/eventos/${editionId}/participantes`} prefetch={false} className="font-semibold underline underline-offset-2">
            Ir a Participantes
          </Link>
        </p>
      ) : null}

      <FinalizationPanel
        workspace={workspace}
        timeZone={timeZone}
        editionId={editionId}
        canOpenClosure={canOpenClosure}
        view={view}
        onFinalize={() => setDialog({ kind: "finalize" })}
        onBulk={() => setDialog({ kind: "bulk" })}
        onReopen={() => setDialog({ kind: "reopen" })}
      />

      <Panel title="Asistencia por inscripción" description="Cada fila muestra la asistencia y, aparte, la elegibilidad deportiva.">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="desk-search" className="text-label font-semibold text-ink">
                Buscar
              </label>
              <SearchInput
                id="desk-search"
                value={filters.search}
                placeholder="Nombre o número"
                onChange={(event) => patchFilters({ search: event.target.value })}
                onClear={() => patchFilters({ search: "" })}
                autoComplete="off"
              />
            </div>
            <SelectField
              id="desk-modality"
              label="Modalidad"
              value={filters.modalityId}
              options={[{ value: "", label: "Todas" }, ...modalities.map((item) => ({ value: item.id, label: item.name }))]}
              onChange={(event) => patchFilters({ modalityId: event.target.value })}
            />
            <SelectField
              id="desk-eligibility"
              label="Elegibilidad"
              value={filters.eligibility}
              options={[
                { value: "ALL", label: "Todas" },
                ...(Object.keys(ELIGIBILITY_LABEL) as EligibilityStatus[]).map((value) => ({ value, label: ELIGIBILITY_LABEL[value] })),
                { value: "PENDING_DISPOSITION", label: "Crédito por decidir" },
              ]}
              onChange={(event) => patchFilters({ eligibility: event.target.value as DeskFilters["eligibility"] })}
            />
            <SelectField
              id="desk-source"
              label="Origen"
              value={filters.source}
              options={[{ value: "ALL", label: "Todos" }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))]}
              onChange={(event) => patchFilters({ source: event.target.value })}
            />
            <div className="flex items-end pb-5">
              <Button variant="secondary" size="md" disabled={!hasActiveFilters(filters)} onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
                Limpiar filtros
              </Button>
            </div>
          </div>

          <p className="text-caption text-ink-60" role="status" aria-live="polite" data-testid="result-summary">
            {filtered.length === 0
              ? "Sin resultados con estos filtros."
              : `Mostrando ${shown.from}–${shown.to} de ${filtered.length} ${filtered.length === 1 ? "inscripción" : "inscripciones"}${hasActiveFilters(filters) ? " (filtradas)" : ""}.`}
          </p>

          <AttendanceTable
            rows={shown.rows}
            canAttendance={canResolveAttendance(workspace)}
            canEligibility={canResolveEligibility(workspace)}
            onAttendance={(row) => setDialog({ kind: "attendance", row })}
            onEligibility={(row) => setDialog({ kind: "eligibility", row })}
            filtersActive={hasActiveFilters(filters)}
          />

          {shown.pageCount > 1 || filtered.length > PAGE_SIZES[0] ? (
            <nav aria-label="Paginación de la lista" className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label htmlFor="desk-page-size" className="text-caption text-ink-60">
                  Filas por página
                </label>
                <select
                  id="desk-page-size"
                  value={pageSize}
                  onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
                  className="h-11 rounded-control border border-control bg-paper-raised px-3 text-body-sm text-ink"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={shown.page <= 1} onClick={() => setPage(shown.page - 1)}>
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  Anterior
                </Button>
                <span className="text-caption text-ink-80" data-testid="page-position">
                  Página {shown.page} de {shown.pageCount}
                </span>
                <Button variant="secondary" size="sm" disabled={shown.page >= shown.pageCount} onClick={() => setPage(shown.page + 1)}>
                  Siguiente
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      </Panel>

      {dialog?.kind === "attendance" ? (
        <ResolveAttendanceDialog
          key={dialog.row.registration_id}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onRefusal={onRefusal}
          onResolved={(result, row) =>
            done({
              tone: "success",
              title: "Asistencia guardada",
              text: `${displayName(row)}: ${ATTENDANCE_LABEL[result.status]} (${SOURCE_LABEL[result.source] ?? result.source}).`,
            })
          }
        />
      ) : null}
      {dialog?.kind === "eligibility" ? (
        <ResolveEligibilityDialog
          key={dialog.row.registration_id}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onRefusal={onRefusal}
          onResolved={(result, row) =>
            done({
              tone: "success",
              title: "Elegibilidad guardada",
              text: `${displayName(row)}: ${ELIGIBILITY_LABEL[result.status]} · ${DISPOSITION_LABEL[result.distance_credit_disposition]}.`,
            })
          }
        />
      ) : null}
      {dialog?.kind === "finalize" ? (
        <SimpleCommandDialog
          kind="finalize"
          title="Finalizar la asistencia"
          description="Congela la asistencia de toda la edición."
          confirmLabel="Finalizar asistencia"
          path={`${adminBase(editionId)}/attendance/finalize`}
          schema={attendanceFinalizationSchema}
          buildBody={() => ({})}
          consequences={<FinalizeConsequences workspace={workspace} />}
          onRefusal={onRefusal}
          onClose={() => setDialog(null)}
          onDone={(result) => done(finalizedOutcome(result, timeZone))}
        />
      ) : null}
      {dialog?.kind === "bulk" ? (
        <SimpleCommandDialog
          kind="finalize"
          title="Marcar a los pendientes como «No se presentó» y finalizar"
          description="Es una sola operación: si algo bloquea la finalización, no se marca a nadie."
          confirmLabel={`Marcar ${view.pendingAttendance} y finalizar`}
          tone="danger"
          path={`${adminBase(editionId)}/attendance/finalize`}
          schema={attendanceFinalizationSchema}
          buildBody={(reason) => ({ mark_remaining_no_show: true, reason })}
          count={{ value: view.pendingAttendance, noun: view.pendingAttendance === 1 ? "inscripción pendiente" : "inscripciones pendientes" }}
          reason={{ label: "Motivo", required: true, helper: "Queda en la auditoría junto con el número de inscripciones marcadas." }}
          confirm={{ label: `Confirmo que las ${view.pendingAttendance} inscripciones pendientes no se presentaron.` }}
          consequences={<BulkConsequences workspace={workspace} />}
          onRefusal={onRefusal}
          onClose={() => setDialog(null)}
          onDone={(result) => done(finalizedOutcome(result, timeZone, view.pendingAttendance))}
        />
      ) : null}
      {dialog?.kind === "reopen" ? (
        <SimpleCommandDialog
          kind="reopen_finalization"
          title="Reabrir la finalización de asistencia"
          description="La asistencia vuelve a ser editable y habrá que finalizarla de nuevo."
          confirmLabel="Reabrir finalización"
          tone="danger"
          path={`${adminBase(editionId)}/attendance/reopen`}
          schema={reopenFinalizationResultSchema}
          buildBody={(reason) => ({ reason })}
          reason={{ label: "Motivo de la reapertura", required: true, helper: "Obligatorio: queda en la auditoría." }}
          consequences={
            <ul className="list-disc space-y-1 pl-5">
              <li>La finalización vigente queda sustituida (se conserva su historial) y la próxima será una revisión nueva.</li>
              <li>Vuelven a poder resolverse la asistencia y la elegibilidad, y a cancelarse o cambiar de modalidad una inscripción.</li>
              <li>Hasta que finalices otra vez, la edición no puede cerrarse.</li>
            </ul>
          }
          onRefusal={onRefusal}
          onClose={() => setDialog(null)}
          onDone={() => done({ tone: "info", title: "Finalización reabierta", text: "La asistencia vuelve a ser editable. Resuelve lo necesario y finaliza de nuevo." })}
        />
      ) : null}
    </div>
  );
}

function finalizedOutcome(result: AttendanceFinalization, timeZone: string, marked?: number): Outcome {
  const base = `Revisión ${result.revision}: ${plural(result.present_count, "presente", "presentes")}, ${result.no_show_count} no se presentaron, ${plural(result.excluded_count, "excluido", "excluidos")} de ${result.expected_count} esperados (${formatDateTime(result.finalized_at, timeZone)}).`;
  return {
    tone: "success",
    title: "Asistencia finalizada",
    text: marked !== undefined ? `${base} Se marcaron ${plural(marked, "inscripción pendiente", "inscripciones pendientes")} como «No se presentó».` : base,
  };
}

function uniqueModalities(rows: readonly AttendanceWorkspaceParticipant[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const row of rows) seen.set(row.modality.modality_id, row.modality.name);
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// ---- Counts ------------------------------------------------------------------------------------------------------------------------

const STATUS_ICON: Record<AttendanceStatus, LucideIcon> = { PRESENT: CircleCheck, PENDING: Hourglass, NO_SHOW: UserX, EXCLUDED: Ban };

function StatRow({ workspace, filters, onFilter }: { workspace: AttendanceWorkspace; filters: DeskFilters; onFilter: (status: AttendanceStatus | "ALL") => void }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label="Resumen de asistencia">
      <li>
        <button
          type="button"
          onClick={() => onFilter("ALL")}
          aria-pressed={filters.status === "ALL"}
          data-testid="stat-ALL"
          className={`block min-h-11 w-full rounded-card border p-4 text-left transition-colors duration-fast ease-standard ${filters.status === "ALL" ? "border-ink bg-paper-sunken" : "border-divider bg-paper-raised hover:border-ink-60"}`}
        >
          <p className="flex items-center gap-1.5 text-label font-semibold text-ink-60">
            <Users className="size-4" aria-hidden="true" />
            Universo
          </p>
          <p className="mt-1 font-display text-h3 font-bold tabular-nums text-ink" data-testid="stat-ALL-value">
            {workspace.universe_count}
          </p>
          <p className="text-caption text-ink-60">Inscripciones confirmadas</p>
        </button>
      </li>
      {ATTENDANCE_ORDER.map((status) => {
        const Icon = STATUS_ICON[status];
        const active = filters.status === status;
        return (
          <li key={status}>
            <button
              type="button"
              onClick={() => onFilter(active ? "ALL" : status)}
              aria-pressed={active}
              data-testid={`stat-${status}`}
              className={`block min-h-11 w-full rounded-card border p-4 text-left transition-colors duration-fast ease-standard ${active ? "border-ink bg-paper-sunken" : "border-divider bg-paper-raised hover:border-ink-60"}`}
            >
              <p className="flex items-center gap-1.5 text-label font-semibold text-ink-60">
                <Icon className="size-4" aria-hidden="true" />
                {ATTENDANCE_LABEL[status]}
              </p>
              <p className="mt-1 font-display text-h3 font-bold tabular-nums text-ink" data-testid={`stat-${status}-value`}>
                {workspace.attendance_counts[status] ?? 0}
              </p>
              <p className="text-caption text-ink-60">{active ? "Filtrando la lista" : "Ver en la lista"}</p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Finalization panel ------------------------------------------------------------------------------------------------------------

function FinalizationPanel({
  workspace,
  timeZone,
  editionId,
  canOpenClosure,
  view,
  onFinalize,
  onBulk,
  onReopen,
}: {
  workspace: AttendanceWorkspace;
  timeZone: string;
  editionId: string;
  canOpenClosure: boolean;
  view: ReturnType<typeof finalizeView>;
  onFinalize: () => void;
  onBulk: () => void;
  onReopen: () => void;
}) {
  const blocking = finalizeBlockingText(view);
  const finalization = workspace.current_finalization;
  const closure = workspace.current_closure;
  const blockingId = React.useId();
  const eligibility = workspace.eligibility_counts;

  return (
    <Panel title="Finalización de la asistencia" description="Finalizar congela la asistencia de la edición. Sin pendientes de asistencia ni de crédito.">
      {view.stage === "OPEN" ? (
        <div className="flex flex-col gap-4">
          <ReadinessList title="Preparación para finalizar" ready={view.ready} checks={workspace.finalize_readiness.checks.filter((check) => check.code !== "NOT_ALREADY_FINALIZED")} testId="finalize-readiness" />
          <p className="text-caption text-ink-60" data-testid="eligibility-counts">
            Elegibilidad: {eligibility.ELIGIBLE ?? 0} elegibles · {eligibility.PENDING_REVIEW ?? 0} en revisión · {eligibility.DISQUALIFIED ?? 0} descalificados ·{" "}
            {eligibility.EXCLUDED ?? 0} excluidos · {workspace.disposition_pending_count} con el crédito por decidir.
          </p>
          <div className="flex flex-col gap-2 border-t border-divider pt-4" data-testid="finalize-bar">
            <div className="flex flex-wrap items-center gap-3">
              <Button className="max-w-full" onClick={onFinalize} disabled={!view.ready} aria-describedby={blocking ? blockingId : undefined} data-testid="finalize-button">
                <CircleCheck className="size-4" aria-hidden="true" />
                Finalizar asistencia
              </Button>
              {view.canMarkRemaining ? (
                <Button variant="secondary" onClick={onBulk} data-testid="bulk-button" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-left">
                  <UserX className="size-4" aria-hidden="true" />
                  Marcar los {view.pendingAttendance} pendientes como «No se presentó»…
                </Button>
              ) : null}
            </div>
            {blocking ? (
              <p id={blockingId} className="flex items-start gap-1.5 text-body-sm text-ink" data-testid="finalize-blocking">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                {blocking}
              </p>
            ) : (
              <p className="text-body-sm text-ink-80">Todo está resuelto: ya puedes finalizar.</p>
            )}
            {view.canMarkRemaining ? (
              <p className="text-caption text-ink-60">
                El paso masivo solo toca a quienes siguen pendientes ahora; no modifica a los presentes ni a los excluidos. Pide una confirmación con el número exacto antes de aplicar.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="finalization-summary">
          {finalization ? (
            <>
              <DefinitionList
                columns={3}
                items={[
                  { label: "Revisión", value: `${finalization.revision} · ${revisionText("finalization", finalization.revision)}` },
                  { label: "Finalizada por", value: formatStaffLabel(finalization.finalized_by_staff_label, finalization.finalized_by_staff_id) ?? "Personal del staff" },
                  { label: "Cuándo", value: formatDateTime(finalization.finalized_at, timeZone) },
                  { label: "Esperados", value: finalization.expected_count },
                  { label: "Presentes", value: finalization.present_count },
                  { label: "No se presentaron", value: finalization.no_show_count },
                  { label: "Excluidos", value: finalization.excluded_count },
                ]}
              />
            </>
          ) : null}
          {view.stage === "FINALIZED" ? (
            <>
              <p className="text-body-sm text-ink-80">
                Con la asistencia finalizada no se puede resolver asistencia, cancelar ni cambiar de modalidad. La elegibilidad sí se puede ajustar hasta el cierre. Para corregir la asistencia,
                reabre la finalización.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={onReopen} data-testid="reopen-button">
                  Reabrir finalización
                </Button>
                {canOpenClosure ? (
                  <Link href={`/admin/eventos/${editionId}/cierre`} prefetch={false} className={buttonVariants({ variant: "primary", size: "md" })}>
                    Ir al cierre de la edición
                  </Link>
                ) : (
                  <span className="text-caption text-ink-60">El cierre de la edición lo hace un administrador global.</span>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2" data-testid="closed-note">
              <p className="flex items-start gap-1.5 text-body-sm text-ink">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <span>
                  La edición está <strong>cerrada</strong>
                  {closure ? ` (revisión ${closure.revision}, ${formatDateTime(closure.closed_at, timeZone)})` : ""}. Para corregir, un administrador global reabre primero el cierre y después se reabre la finalización.
                </span>
              </p>
              {canOpenClosure ? (
                <div>
                  <Link href={`/admin/eventos/${editionId}/cierre`} prefetch={false} className={buttonVariants({ variant: "secondary", size: "md" })}>
                    Ir al cierre de la edición
                  </Link>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function FinalizeConsequences({ workspace }: { workspace: AttendanceWorkspace }) {
  const c = workspace.attendance_counts;
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>
        Se congela la asistencia de {workspace.universe_count} inscripciones: {c.PRESENT ?? 0} presentes, {c.NO_SHOW ?? 0} no se presentaron y {c.EXCLUDED ?? 0} excluidas.
      </li>
      <li>Después no se podrá resolver asistencia, ni cancelar o cambiar de modalidad una inscripción, hasta que alguien reabra la finalización.</li>
      <li>La finalización no cierra la edición: el cierre y los créditos de distancia son un paso aparte, solo de un administrador global.</li>
    </ul>
  );
}

function BulkConsequences({ workspace }: { workspace: AttendanceWorkspace }) {
  const c = workspace.attendance_counts;
  return (
    <ul className="list-disc space-y-1 pl-5">
      <li>
        Se marcarán como «No se presentó» las <strong>{c.PENDING ?? 0}</strong> inscripciones que siguen pendientes ahora.
      </li>
      <li>
        <strong>No se toca</strong> a quienes ya están presentes ({c.PRESENT ?? 0}) ni excluidos ({c.EXCLUDED ?? 0}), ni a quienes ya se marcaron como no presentados ({c.NO_SHOW ?? 0}).
      </li>
      <li>Después se finaliza la asistencia. Si la finalización se rechaza (por ejemplo, un crédito por decidir), no se marca a nadie.</li>
    </ul>
  );
}

// ---- Table -------------------------------------------------------------------------------------------------------------------------

const ATTENDANCE_BADGE: Record<AttendanceStatus, { icon: LucideIcon; tone: BadgeTone }> = {
  PRESENT: { icon: CircleCheck, tone: "success" },
  PENDING: { icon: Hourglass, tone: "warning" },
  NO_SHOW: { icon: UserX, tone: "neutral" },
  EXCLUDED: { icon: Ban, tone: "neutral" },
};

const ELIGIBILITY_BADGE: Record<EligibilityStatus, { icon: LucideIcon; tone: BadgeTone }> = {
  ELIGIBLE: { icon: CircleCheck, tone: "neutral" },
  DISQUALIFIED: { icon: ShieldAlert, tone: "danger" },
  EXCLUDED: { icon: Ban, tone: "danger" },
  PENDING_REVIEW: { icon: Hourglass, tone: "warning" },
};

function AttendanceTable({
  rows,
  canAttendance,
  canEligibility,
  onAttendance,
  onEligibility,
  filtersActive,
}: {
  rows: AttendanceWorkspaceParticipant[];
  canAttendance: boolean;
  canEligibility: boolean;
  onAttendance: (row: AttendanceWorkspaceParticipant) => void;
  onEligibility: (row: AttendanceWorkspaceParticipant) => void;
  filtersActive: boolean;
}) {
  const columns = React.useMemo<DataTableColumn<AttendanceWorkspaceParticipant>[]>(
    () => [
      {
        key: "number",
        header: "Inscripción",
        priority: 1,
        render: (row) => (
          <div>
            <p className="font-mono text-caption font-semibold text-ink">{row.registration_number}</p>
            <p className="text-caption text-ink-60">{KIND_LABEL[row.participant_kind] ?? row.participant_kind}</p>
          </div>
        ),
      },
      {
        key: "name",
        header: "Participante",
        priority: 2,
        render: (row) => (
          <div className="min-w-0">
            <p className="font-semibold text-ink">{displayName(row)}</p>
            {row.guardian_status ? <p className="text-caption text-ink-60">{GUARDIAN_LABEL[row.guardian_status] ?? row.guardian_status}</p> : null}
          </div>
        ),
      },
      {
        key: "attendance",
        header: "Asistencia",
        priority: 3,
        render: (row) => {
          const status = row.attendance.status;
          if (!status) return <span className="text-ink-60">Sin resolver</span>;
          const badge = ATTENDANCE_BADGE[status];
          return (
            <div className="min-w-0" data-attendance={status} data-source={row.attendance.source ?? ""}>
              <AdminBadge icon={badge.icon} tone={badge.tone}>
                {ATTENDANCE_LABEL[status]}
              </AdminBadge>
              <p className="mt-0.5 text-caption text-ink-60">{row.attendance.source ? (SOURCE_LABEL[row.attendance.source] ?? row.attendance.source) : ""}</p>
              {row.attendance.reason ? <p className="max-w-56 truncate text-caption text-ink-60" title={row.attendance.reason}>{row.attendance.reason}</p> : null}
            </div>
          );
        },
      },
      {
        key: "eligibility",
        header: "Elegibilidad",
        priority: 4,
        render: (row) => {
          const status = row.eligibility.status;
          if (!status) return <span className="text-ink-60">Sin resolver</span>;
          const badge = ELIGIBILITY_BADGE[status];
          const disposition = row.eligibility.distance_credit_disposition;
          return (
            <div data-eligibility={status} data-disposition={disposition ?? ""}>
              <AdminBadge icon={badge.icon} tone={badge.tone}>
                {ELIGIBILITY_LABEL[status]}
              </AdminBadge>
              {disposition ? <p className="mt-0.5 text-caption text-ink-60">{DISPOSITION_LABEL[disposition]}</p> : null}
            </div>
          );
        },
      },
      { key: "modality", header: "Modalidad", priority: 5, render: (row) => row.modality.name },
      {
        key: "credit",
        header: "Crédito de distancia",
        priority: 6,
        render: (row) =>
          row.has_active_credit ? (
            <AdminBadge icon={CircleCheck} tone="success">
              Con crédito
            </AdminBadge>
          ) : row.participant_kind === "GUEST" ? (
            <span className="text-caption text-ink-60">No acredita (invitado)</span>
          ) : (
            <span className="text-caption text-ink-60">Sin crédito</span>
          ),
      },
    ],
    [],
  );
  return (
    <DataTable
      caption="Asistencia y elegibilidad por inscripción"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.registration_id}
      getRowLabel={(row) => displayName(row)}
      keepColumnsBelowLg={4}
      keepColumnsBelowMd={3}
      emptyState={{
        icon: Users,
        title: filtersActive ? "Ninguna inscripción coincide" : "No hay inscripciones confirmadas",
        description: filtersActive ? "Cambia la búsqueda o limpia los filtros." : "Cuando haya inscripciones confirmadas aparecerán aquí.",
        headingLevel: "h3",
      }}
      rowActions={(row) =>
        canAttendance || canEligibility ? (
          <div className="flex flex-wrap justify-end gap-2">
            {canAttendance ? (
              <Button size="sm" variant="secondary" onClick={() => onAttendance(row)}>
                Asistencia<span className="sr-only"> de {displayName(row)}</span>
              </Button>
            ) : null}
            {canEligibility ? (
              <Button size="sm" variant="secondary" onClick={() => onEligibility(row)}>
                Elegibilidad<span className="sr-only"> de {displayName(row)}</span>
              </Button>
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
