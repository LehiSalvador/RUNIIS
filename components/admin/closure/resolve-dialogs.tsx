"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ModalActions, ModalClose } from "@/components/ui/modal";
import type { ApiFailure } from "@/lib/client/api";
import {
  attendanceResolutionSchema,
  sportingEligibilitySchema,
  type AttendanceResolution,
  type AttendanceWorkspaceParticipant,
  type SportingEligibility,
} from "@/lib/shared/closure";
import { InputField, SelectField, TextareaField } from "@/components/admin/events/fields";
import { CommandFailure, CommandModal } from "@/components/admin/closure/command-modal";
import { useCommand } from "@/components/admin/closure/closure-api";
import {
  ATTENDANCE_LABEL,
  DISPOSITION_LABEL,
  ELIGIBILITY_LABEL,
  EVIDENCE_METHODS,
  SOURCE_LABEL,
  dispositionOptions,
  displayName,
  eligibilityFormFor,
  emptyAttendanceForm,
  validateAttendance,
  validateEligibility,
  type AttendanceErrors,
  type AttendanceForm,
  type EligibilityErrors,
  type EligibilityForm,
  type EligibilityStatus,
} from "@/components/admin/closure/closure-logic";

/**
 * Per-row dialogs of the attendance desk. Manual PRESENT requires a reason AND evidence (a scan is evidence, a bare claim is not); EXCLUDED
 * requires a reason; NO_SHOW needs neither. Eligibility is separate from attendance (PRESENT and DISQUALIFIED can coexist): a final
 * DISQUALIFIED / EXCLUDED must say, explicitly, whether the distance still counts; PENDING is only the transient "under review" state.
 */
export function ResolveAttendanceDialog({
  row,
  onClose,
  onResolved,
  onRefusal,
}: {
  row: AttendanceWorkspaceParticipant;
  onClose: () => void;
  onResolved: (result: AttendanceResolution, row: AttendanceWorkspaceParticipant) => void;
  onRefusal: (failure: ApiFailure) => void;
}) {
  const { run, pending, failure } = useCommand(onRefusal);
  const [form, setForm] = React.useState<AttendanceForm>(() => emptyAttendanceForm());
  const [errors, setErrors] = React.useState<AttendanceErrors>({});
  const name = displayName(row);
  const status = row.attendance.status;
  const set = <K extends keyof AttendanceForm>(key: K, value: AttendanceForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function submit() {
    if (pending) return;
    const decision = validateAttendance(form);
    if (!decision.ok) {
      setErrors(decision.errors);
      return;
    }
    setErrors({});
    const result = await run(`/api/v1/admin/registrations/${row.registration_id}/attendance/resolve`, decision.body, attendanceResolutionSchema);
    if (result) {
      onClose();
      onResolved(result, row);
    }
  }

  return (
    <CommandModal title={`Resolver asistencia de ${name}`} description={`Inscripción ${row.registration_number} · ${row.modality.name}`} onClose={onClose} locked={pending}>
      <form
        className="flex flex-col gap-1"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="mb-2 rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm text-ink" data-testid="current-attendance">
          Ahora: <strong>{status ? ATTENDANCE_LABEL[status] : "Sin resolver"}</strong>
          {row.attendance.source ? ` · ${SOURCE_LABEL[row.attendance.source] ?? row.attendance.source}` : ""}
          {row.attendance.source === "CHECKIN" ? (
            <span className="mt-1 block text-caption text-ink-80">
              El check-in es evidencia de llegada; el servidor lo preclasificó como presente. Si no corresponde, corrígelo aquí: queda el historial.
            </span>
          ) : null}
          {status === "PENDING" ? <span className="mt-1 block text-caption text-ink-80">Sin check-in no significa que no se presentó: confirma antes de marcarlo.</span> : null}
        </p>

        <SelectField
          id="attendance-status"
          label="Resultado de asistencia"
          required
          value={form.status}
          error={errors.status}
          options={[
            { value: "", label: "Elige un resultado" },
            { value: "PRESENT", label: "Presente (con motivo y evidencia)" },
            { value: "NO_SHOW", label: "No se presentó" },
            { value: "EXCLUDED", label: "Excluido (con motivo)" },
          ]}
          onChange={(event) => set("status", event.target.value as AttendanceForm["status"])}
        />

        {form.status === "PRESENT" ? (
          <>
            <SelectField
              id="attendance-method"
              label="Cómo se comprobó la llegada"
              required
              value={form.method}
              error={errors.method}
              options={[{ value: "", label: "Elige un método" }, ...EVIDENCE_METHODS]}
              onChange={(event) => set("method", event.target.value)}
            />
            <TextareaField
              id="attendance-note"
              label="Evidencia"
              required
              value={form.note}
              error={errors.note}
              maxLength={500}
              helperText="Qué se vio o revisó, dónde y quién. Queda en el historial."
              onChange={(event) => set("note", event.target.value)}
            />
          </>
        ) : null}

        {form.status ? (
          <TextareaField
            id="attendance-reason"
            label="Motivo"
            required={form.status !== "NO_SHOW"}
            value={form.reason}
            error={errors.reason}
            maxLength={500}
            helperText={form.status === "NO_SHOW" ? "Opcional; recomendable si corriges una asistencia ya resuelta." : "Queda en la auditoría."}
            onChange={(event) => set("reason", event.target.value)}
          />
        ) : null}

        {failure ? <CommandFailure failure={failure} kind="resolve_attendance" onRetry={() => void submit()} /> : null}
        <ModalActions>
          <ModalClose asChild>
            <Button type="button" variant="secondary" disabled={pending}>
              Cancelar
            </Button>
          </ModalClose>
          <Button type="submit" loading={pending}>
            Guardar asistencia
          </Button>
        </ModalActions>
      </form>
    </CommandModal>
  );
}

const ELIGIBILITY_OPTIONS = (Object.keys(ELIGIBILITY_LABEL) as EligibilityStatus[]).map((value) => ({ value, label: ELIGIBILITY_LABEL[value] }));

export function ResolveEligibilityDialog({
  row,
  onClose,
  onResolved,
  onRefusal,
}: {
  row: AttendanceWorkspaceParticipant;
  onClose: () => void;
  onResolved: (result: SportingEligibility, row: AttendanceWorkspaceParticipant) => void;
  onRefusal: (failure: ApiFailure) => void;
}) {
  const { run, pending, failure } = useCommand(onRefusal);
  const [form, setForm] = React.useState<EligibilityForm>(() => eligibilityFormFor(row));
  const [errors, setErrors] = React.useState<EligibilityErrors>({});
  const name = displayName(row);
  const options = dispositionOptions(form.status);
  const isGuest = row.participant_kind === "GUEST";

  function setStatus(status: EligibilityForm["status"]) {
    setForm((current) => {
      // The disposition follows the status: PENDING_REVIEW only carries PENDING; a final status must choose ALLOW or DENY explicitly.
      // DISQUALIFIED / EXCLUDED never inherit a previous choice: the operator decides explicitly at the moment of the decision (J5.4).
      const disposition = status === "ELIGIBLE" ? "ALLOW" : status === "PENDING_REVIEW" ? "PENDING" : "";
      return { ...current, status, disposition };
    });
    setErrors({});
  }

  async function submit() {
    if (pending) return;
    const decision = validateEligibility(form);
    if (!decision.ok) {
      setErrors(decision.errors);
      return;
    }
    setErrors({});
    const result = await run(`/api/v1/admin/registrations/${row.registration_id}/sporting-eligibility/resolve`, decision.body, sportingEligibilitySchema);
    if (result) {
      onClose();
      onResolved(result, row);
    }
  }

  return (
    <CommandModal title={`Elegibilidad deportiva de ${name}`} description={`Inscripción ${row.registration_number} · ${row.modality.name}`} onClose={onClose} locked={pending}>
      <form
        className="flex flex-col gap-1"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="mb-2 rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm text-ink" data-testid="current-eligibility">
          Ahora:{" "}
          <strong>
            {row.eligibility.status ? ELIGIBILITY_LABEL[row.eligibility.status] : "Sin resolver"}
            {row.eligibility.distance_credit_disposition ? ` · ${DISPOSITION_LABEL[row.eligibility.distance_credit_disposition]}` : ""}
          </strong>
          <span className="mt-1 block text-caption text-ink-80">
            Es independiente de la asistencia: una persona puede estar presente y descalificada. Todas empiezan elegibles con el crédito permitido; usa esto solo para denegar
            kilómetros o abrir una revisión.
            {isGuest ? " Un invitado nunca recibe crédito de distancia, decidas lo que decidas." : ""}
          </span>
        </p>

        <SelectField
          id="eligibility-status"
          label="Elegibilidad"
          required
          value={form.status}
          error={errors.status}
          options={[{ value: "", label: "Elige una opción" }, ...ELIGIBILITY_OPTIONS]}
          onChange={(event) => setStatus(event.target.value as EligibilityForm["status"])}
        />
        {form.status ? (
          <SelectField
            id="eligibility-disposition"
            label="Crédito de distancia"
            required
            value={form.status === "PENDING_REVIEW" ? "PENDING" : form.disposition}
            error={errors.disposition}
            disabled={form.status === "PENDING_REVIEW"}
            helperText={
              form.status === "PENDING_REVIEW"
                ? "Mientras esté en revisión el crédito queda por decidir, y eso bloquea finalizar y cerrar."
                : "Denegar significa que no se acreditan kilómetros al cerrar la edición."
            }
            options={[
              ...(form.status === "PENDING_REVIEW" ? [] : [{ value: "", label: "Elige permitir o denegar" }]),
              ...options.map((value) => ({ value, label: DISPOSITION_LABEL[value] })),
            ]}
            onChange={(event) => {
              setForm((current) => ({ ...current, disposition: event.target.value as EligibilityForm["disposition"] }));
              setErrors((current) => ({ ...current, disposition: undefined }));
            }}
          />
        ) : null}
        {form.status ? (
          <TextareaField
            id="eligibility-reason"
            label="Motivo"
            required={form.status === "DISQUALIFIED" || form.status === "EXCLUDED"}
            value={form.reason}
            error={errors.reason}
            maxLength={500}
            helperText="Queda en la auditoría."
            onChange={(event) => {
              setForm((current) => ({ ...current, reason: event.target.value }));
              setErrors((current) => ({ ...current, reason: undefined }));
            }}
          />
        ) : null}
        {form.status ? (
          <InputField
            id="eligibility-code"
            label="Código del motivo (opcional)"
            value={form.reasonCode}
            error={errors.reasonCode}
            maxLength={64}
            helperText="Una clave corta para reportes, por ejemplo DOPING_REVIEW."
            onChange={(event) => {
              setForm((current) => ({ ...current, reasonCode: event.target.value }));
              setErrors((current) => ({ ...current, reasonCode: undefined }));
            }}
          />
        ) : null}

        {failure ? <CommandFailure failure={failure} kind="resolve_eligibility" onRetry={() => void submit()} /> : null}
        <ModalActions>
          <ModalClose asChild>
            <Button type="button" variant="secondary" disabled={pending}>
              Cancelar
            </Button>
          </ModalClose>
          <Button type="submit" loading={pending}>
            Guardar elegibilidad
          </Button>
        </ModalActions>
      </form>
    </CommandModal>
  );
}
