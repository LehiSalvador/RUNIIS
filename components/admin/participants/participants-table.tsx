"use client";

import React from "react";
import { CircleCheck, Eye, Minus, Repeat, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DetailDrawer } from "@/components/admin/detail-drawer";
import { formatDateTime } from "@/components/admin/format";
import { DefinitionList } from "@/components/admin/panel";
import { AdminBadge } from "@/components/admin/status-badges";
import { KIT_STATUS_LABEL } from "@/components/admin/raceday/kit-logic";
import { CancelRegistrationDialog } from "@/components/admin/participants/cancel-registration-dialog";
import { ChangeModalityDialog } from "@/components/admin/participants/change-modality-dialog";
import {
  ATTENDANCE_LABEL,
  GUARDIAN_LABEL,
  KIND_LABEL,
  PASS_STATUS_LABEL,
  REGISTRATION_STATUS_LABEL,
  attendanceText,
  canCancelRegistration,
  canChangeModality,
  displayName,
  type CategoryOption,
  type ModalityOption,
  type ParticipantRowView,
} from "@/components/admin/participants/participant-logic";

/**
 * Participants of one Edition (T13 §4.13). Dense table with the column-priority rule: registration number, name with its kind badge and the
 * pass stay visible on small screens; modality, category, kit, check-in and attendance collapse into the row detail. The contact column
 * exists only when the API sent contact data for this role (PII permission): this component never asks for it and never invents it.
 * "Detalle" opens the participant's quick look, which is where the two staff actions live: change modality and cancel registration (OWN-04).
 */
export function ParticipantsTable({
  rows,
  editionId,
  timeZone,
  modalities,
  categories,
  showContact,
  editionClosed,
}: {
  rows: ParticipantRowView[];
  editionId: string;
  timeZone: string;
  modalities: readonly ModalityOption[];
  categories: readonly CategoryOption[];
  showContact: boolean;
  editionClosed: boolean;
}) {
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [canceling, setCanceling] = React.useState<ParticipantRowView | null>(null);
  const [changing, setChanging] = React.useState<ParticipantRowView | null>(null);
  const viewTarget = viewing ? rows.find((row) => row.registration_id === viewing) : undefined;

  const columns = React.useMemo<DataTableColumn<ParticipantRowView>[]>(() => {
    const base: DataTableColumn<ParticipantRowView>[] = [
      {
        key: "number",
        header: "Inscripción",
        priority: 1,
        render: (row) => (
          <div>
            <p className="font-mono text-caption font-semibold text-ink">{row.registration_number}</p>
            <StatusBadgeRegistration status={row.status} />
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
            <p className="flex flex-wrap items-center gap-1 text-caption text-ink-60">
              <span>{KIND_LABEL[row.participant_kind] ?? row.participant_kind}</span>
              {row.is_minor ? <span>· Menor de edad</span> : null}
            </p>
          </div>
        ),
      },
      {
        key: "pass",
        header: "Pase",
        priority: 3,
        render: (row) =>
          row.pass ? (
            <div>
              <p className="font-mono text-caption whitespace-nowrap text-ink">{row.pass.public_code}</p>
              <p className="text-caption text-ink-60">{PASS_STATUS_LABEL[row.pass.status] ?? row.pass.status}</p>
            </div>
          ) : (
            <span className="text-ink-60">Sin pase</span>
          ),
      },
      {
        key: "modality",
        header: "Modalidad",
        priority: 4,
        render: (row) => row.modality.name,
      },
      { key: "category", header: "Categoría", priority: 5, render: (row) => row.category?.name ?? "—" },
      {
        key: "kit",
        header: "Kit",
        priority: 6,
        render: (row) => (row.kit ? `${KIT_STATUS_LABEL[row.kit.status] ?? row.kit.status} · ${row.kit.variant_label}` : "Sin kit"),
      },
      {
        key: "checkin",
        header: "Check-in",
        priority: 7,
        render: (row) =>
          row.attendance.checked_in ? (
            <AdminBadge icon={CircleCheck} tone="success">
              Hizo check-in
            </AdminBadge>
          ) : (
            <AdminBadge icon={Minus} tone="neutral">
              Sin check-in
            </AdminBadge>
          ),
      },
      { key: "attendance", header: "Asistencia", priority: 8, render: (row) => attendanceText(row) },
    ];
    if (showContact) {
      base.push({
        key: "contact",
        header: "Contacto",
        priority: 9,
        render: (row) =>
          row.contact ? (
            <div className="text-caption">
              <p className="font-mono text-ink">{row.contact.phone_e164 ?? "Sin teléfono"}</p>
              {row.contact.emergency_contact_name ? (
                <p className="text-ink-60">
                  Emergencia: {row.contact.emergency_contact_name} {row.contact.emergency_contact_phone_e164 ?? ""}
                </p>
              ) : null}
            </div>
          ) : (
            "—"
          ),
      });
    }
    return base;
  }, [showContact]);

  return (
    <>
      <DataTable
        caption="Participantes de la edición"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.registration_id}
        getRowLabel={(row) => displayName(row)}
        keepColumnsBelowLg={3}
        keepColumnsBelowMd={3}
        emptyState={{ icon: Users, title: "No hay participantes con estos filtros", description: "Cambia la búsqueda o limpia los filtros.", headingLevel: "h3" }}
        rowActions={(row) => (
          <Button size="sm" variant="secondary" onClick={() => setViewing(row.registration_id)}>
            <Eye className="size-4" aria-hidden="true" />
            Detalle<span className="sr-only"> de {displayName(row)}</span>
          </Button>
        )}
      />

      <DetailDrawer
        open={viewTarget !== undefined}
        onOpenChange={(open) => !open && setViewing(null)}
        title={viewTarget ? displayName(viewTarget) : "Participante"}
        description={viewTarget ? `Inscripción ${viewTarget.registration_number}` : undefined}
        footer={
          viewTarget ? (
            <div className="flex flex-wrap justify-end gap-2">
              {canChangeModality(viewTarget, modalities, viewTarget.modality.modality_id) ? (
                <Button size="sm" variant="secondary" onClick={() => setChanging(viewTarget)}>
                  <Repeat className="size-4" aria-hidden="true" />
                  Cambiar modalidad
                </Button>
              ) : null}
              {canCancelRegistration(viewTarget) ? (
                <Button size="sm" variant="danger" onClick={() => setCanceling(viewTarget)}>
                  <XCircle className="size-4" aria-hidden="true" />
                  Cancelar inscripción
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {viewTarget ? <ParticipantDetail row={viewTarget} timeZone={timeZone} showContact={showContact} /> : null}
      </DetailDrawer>

      {canceling ? <CancelRegistrationDialog key={canceling.registration_id} row={canceling} editionId={editionId} editionClosed={editionClosed} onClose={() => setCanceling(null)} /> : null}
      {changing ? (
        <ChangeModalityDialog key={changing.registration_id} row={changing} editionId={editionId} modalities={modalities} categories={categories} onClose={() => setChanging(null)} />
      ) : null}
    </>
  );
}

function StatusBadgeRegistration({ status }: { status: string }) {
  const confirmed = status === "CONFIRMED";
  return (
    <AdminBadge icon={confirmed ? CircleCheck : XCircle} tone={confirmed ? "success" : "neutral"} className="mt-1">
      {REGISTRATION_STATUS_LABEL[status] ?? status}
    </AdminBadge>
  );
}

function ParticipantDetail({ row, timeZone, showContact }: { row: ParticipantRowView; timeZone: string; showContact: boolean }) {
  return (
    <div className="flex flex-col gap-4" data-testid="participant-detail">
      <DefinitionList
        columns={1}
        items={[
          { label: "Estado de la inscripción", value: <StatusBadgeRegistration status={row.status} /> },
          { label: "Tipo", value: `${KIND_LABEL[row.participant_kind] ?? row.participant_kind}${row.participant_kind === "GUEST" ? " (inscrito por el comprador)" : ""}` },
          { label: "Comprador", value: row.buyer_full_name },
          { label: "Confirmada", value: formatDateTime(row.confirmed_at, timeZone) },
          { label: "Modalidad", value: row.modality.name },
          { label: "Categoría", value: row.category?.name ?? "Sin categoría" },
          ...(row.is_minor
            ? [{ label: "Menor de edad", value: row.guardian_verification_status ? (GUARDIAN_LABEL[row.guardian_verification_status] ?? row.guardian_verification_status) : "Sin verificación de tutor" }]
            : []),
        ]}
      />
      <DefinitionList
        columns={1}
        items={[
          { label: "Pase", value: row.pass ? `${row.pass.public_code} · ${PASS_STATUS_LABEL[row.pass.status] ?? row.pass.status}${row.pass.has_active_credential ? "" : " · sin QR vigente"}` : "Sin pase" },
          { label: "Kit", value: row.kit ? `${KIT_STATUS_LABEL[row.kit.status] ?? row.kit.status} · ${row.kit.variant_label}` : "Sin kit asignado" },
          { label: "Check-in", value: row.attendance.checked_in ? "Sí, ya hizo check-in" : "Todavía no" },
          { label: "Asistencia", value: row.attendance.resolution_status ? (ATTENDANCE_LABEL[row.attendance.resolution_status] ?? row.attendance.resolution_status) : "Sin resolver" },
        ]}
      />
      {showContact ? (
        <DefinitionList
          columns={1}
          items={
            row.contact
              ? [
                  { label: "Teléfono", value: <span className="font-mono">{row.contact.phone_e164 ?? "Sin teléfono"}</span> },
                  { label: "Contacto de emergencia", value: row.contact.emergency_contact_name ?? "Sin contacto" },
                  { label: "Teléfono de emergencia", value: <span className="font-mono">{row.contact.emergency_contact_phone_e164 ?? "—"}</span> },
                ]
              : [{ label: "Contacto", value: "No disponible para esta inscripción" }]
          }
        />
      ) : null}
    </div>
  );
}
