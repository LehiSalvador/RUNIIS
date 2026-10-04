"use client";

import React from "react";
import { CircleAlert, Clock, ShieldCheck, ShieldX, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { Panel } from "@/components/admin/panel";
import { AdminBadge } from "@/components/admin/status-badges";
import { SelectField, TextareaField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import { formatDateTime } from "@/components/admin/format";
import { GUARDIAN_METHODS, buildGuardianReject, buildGuardianVerify, guardianRejectPath, guardianVerifyPath } from "@/components/scanner/scan-api";

/**
 * Guardian desk (Master §21, T12 J4 step 3): a minor cannot complete check-in until an adult responsible for them is verified IN PERSON
 * for this Edition. The desk lists the minors whose verification is pending (or was rejected) and records the decision as evidence
 * through the API: the method, the notes (who the adult is) and the staff member are stored by the server. The adult does NOT need
 * a registration: the evidence is attached to the minor's.
 *
 * The list only contains minors a pass was already presented for (the database creates the pending row on the first scan), so a minor
 * who has not arrived does not appear yet; the scanner opens the same decision on the spot.
 */
export type GuardianRow = {
  guardian_event_verification_id: string;
  status: "PENDING" | "REJECTED";
  created_at: string;
  participant: {
    registration_id: string;
    registration_number: string;
    display_name: string | null;
    modality: { name: string };
    category: { name: string } | null;
  };
};

export function GuardianDesk({ rows, timezone }: { rows: GuardianRow[]; timezone?: string | null }) {
  const [verify, setVerify] = React.useState<GuardianRow | null>(null);
  const [reject, setReject] = React.useState<GuardianRow | null>(null);

  const columns = React.useMemo<DataTableColumn<GuardianRow>[]>(
    () => [
      {
        key: "name",
        header: "Menor",
        priority: 1,
        render: (row) => (
          <div className="min-w-0">
            <p className="font-semibold text-ink">{row.participant.display_name ?? "Sin nombre"}</p>
            <p className="text-caption text-ink-60">Inscripción {row.participant.registration_number}</p>
          </div>
        ),
      },
      {
        key: "status",
        header: "Verificación",
        priority: 2,
        render: (row) =>
          row.status === "PENDING" ? (
            <AdminBadge icon={Clock} tone="warning">
              Por verificar
            </AdminBadge>
          ) : (
            <AdminBadge icon={ShieldX} tone="danger">
              Rechazada
            </AdminBadge>
          ),
      },
      { key: "modality", header: "Modalidad", priority: 3, render: (row) => `${row.participant.modality.name}${row.participant.category ? ` · ${row.participant.category.name}` : ""}` },
      { key: "since", header: "Se presentó", priority: 4, render: (row) => formatDateTime(row.created_at, timezone) },
    ],
    [timezone],
  );

  const pending = rows.filter((row) => row.status === "PENDING").length;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Mesa de tutores" description="Verifica en persona al adulto responsable antes de que el menor haga check-in.">
        <ul className="grid gap-3 text-body-sm text-ink-80 sm:grid-cols-3">
          <li className="flex gap-2">
            <UserCheck className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden="true" />
            Pide una identificación al adulto que lo acompaña.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden="true" />
            Anota quién es y cómo lo verificaste: queda como evidencia. El adulto no necesita estar inscrito.
          </li>
          <li className="flex gap-2">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden="true" />
            Una verificación rechazada no se puede revertir desde aquí: el menor pasa por la mesa de atención.
          </li>
        </ul>
      </Panel>

      <p className="text-caption text-ink-60" role="status" aria-live="polite" data-testid="guardian-count">
        {rows.length === 0 ? "No hay verificaciones pendientes." : `${pending} por verificar · ${rows.length - pending} rechazadas`}
      </p>

      <DataTable
        caption="Verificaciones de guardián"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.guardian_event_verification_id}
        getRowLabel={(row) => row.participant.display_name ?? row.participant.registration_number}
        keepColumnsBelowLg={3}
        keepColumnsBelowMd={2}
        emptyState={{
          icon: ShieldCheck,
          title: "No hay verificaciones pendientes",
          description: "Cuando un menor presente su pase y falte verificar a su guardián, aparecerá aquí y en el escáner.",
          headingLevel: "h2",
        }}
        rowActions={(row) =>
          row.status === "PENDING" ? (
            <div className="flex flex-wrap justify-end gap-1">
              <Button size="sm" onClick={() => setVerify(row)}>
                Verificar<span className="sr-only"> al guardián de {row.participant.display_name ?? row.participant.registration_number}</span>
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setReject(row)}>
                Rechazar<span className="sr-only"> la verificación de {row.participant.display_name ?? row.participant.registration_number}</span>
              </Button>
            </div>
          ) : null
        }
      />

      {verify ? <VerifyDialog key={verify.participant.registration_id} row={verify} onClose={() => setVerify(null)} /> : null}
      {reject ? <RejectDialog key={reject.participant.registration_id} row={reject} onClose={() => setReject(null)} /> : null}
    </div>
  );
}

function VerifyDialog({ row, onClose }: { row: GuardianRow; onClose: () => void }) {
  const [method, setMethod] = React.useState<string>(GUARDIAN_METHODS[0]);
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<{ method?: string; notes?: string }>({});

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const decision = buildGuardianVerify({ method, notes });
    if (!decision.ok) {
      setErrors(decision.errors);
      return null;
    }
    setErrors({});
    return apiFetch(guardianVerifyPath(row.participant.registration_id), { method: "POST", body: decision.body });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Verificar al guardián de ${row.participant.display_name ?? row.participant.registration_number}`}
      description="Confirma que ya verificaste en persona al adulto responsable. Después de guardarlo el menor puede hacer check-in."
      submitLabel="Verificar guardián"
      successMessage="Guardián verificado"
      onSubmit={onSubmit}
    >
      <SelectField
        id="guardian-method"
        label="Cómo lo verificaste"
        required
        value={method}
        error={errors.method}
        options={GUARDIAN_METHODS.map((value) => ({ value, label: value }))}
        onChange={(event) => setMethod(event.target.value)}
      />
      <TextareaField
        id="guardian-notes"
        label="Notas (nombre del adulto, observaciones)"
        value={notes}
        error={errors.notes}
        maxLength={500}
        helperText="Opcional, salvo si elegiste «Otro»."
        onChange={(event) => setNotes(event.target.value)}
      />
    </FormDialog>
  );
}

function RejectDialog({ row, onClose }: { row: GuardianRow; onClose: () => void }) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const decision = buildGuardianReject(reason);
    if (!decision.ok) {
      setError(decision.error);
      return null;
    }
    setError(undefined);
    return apiFetch(guardianRejectPath(row.participant.registration_id), { method: "POST", body: decision.body });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Rechazar la verificación de ${row.participant.display_name ?? row.participant.registration_number}`}
      description="El menor no podrá hacer check-in sin verificación y esta decisión no se revierte desde esta pantalla."
      submitLabel="Rechazar verificación"
      successMessage="Verificación rechazada"
      tone="danger"
      onSubmit={onSubmit}
    >
      <TextareaField
        id="guardian-reject-reason"
        label="Motivo"
        required
        value={reason}
        error={error}
        maxLength={500}
        helperText="Queda como evidencia."
        onChange={(event) => setReason(event.target.value)}
      />
    </FormDialog>
  );
}
