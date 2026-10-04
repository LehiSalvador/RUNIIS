"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { changeModalityResultSchema, type ChangeModalityResult } from "@/lib/shared/closure";
import { ErrorNoticeView } from "@/components/admin/error-notice";
import { describeFailure } from "@/components/admin/errors";
import { SelectField, TextareaField } from "@/components/admin/events/fields";
import { useReturnFocus } from "@/components/admin/use-return-focus";
import { isTransientFailure } from "@/components/admin/requests/request-logic";
import {
  changeFailureCopy,
  closureBlockedCopy,
  attendanceHref,
  displayName,
  distanceImpactText,
  selectableCategories,
  targetModalities,
  validateChange,
  type CategoryOption,
  type ChangeErrors,
  type ModalityOption,
  type ParticipantRowView,
} from "@/components/admin/participants/participant-logic";

/**
 * Change a CONFIRMED registration to another modality of the same Edition (Master §78-79). The server checks capacity of the target
 * (modality and Edition), eligibility, the category and the target's forms, and refuses once attendance is finalized; the dialog shows
 * the refusal in plain words and never reports the move before the server answers. The kit does not change. When the official distance or
 * the distance credit differs, the answer shows the impact.
 */
export function ChangeModalityDialog({
  row,
  editionId,
  modalities,
  categories,
  onClose,
}: {
  row: ParticipantRowView;
  editionId: string;
  modalities: readonly ModalityOption[];
  categories: readonly CategoryOption[];
  onClose: () => void;
}) {
  const pendingRef = React.useRef(false);
  const returnFocus = useReturnFocus();
  const [done, setDone] = React.useState<{ result: ChangeModalityResult; toName: string } | null>(null);
  const name = displayName(row);
  return (
    <Modal open onOpenChange={(next) => (!next && !pendingRef.current ? onClose() : undefined)}>
      <ModalContent
        {...returnFocus}
        title={done ? "Modalidad cambiada" : `Cambiar la modalidad de ${name}`}
        description={done ? `${row.registration_number} · ${name}` : `Inscripción ${row.registration_number} · hoy en ${row.modality.name}.`}
        widthClassName="max-w-xl"
      >
        {done ? (
          <div className="flex flex-col gap-3" data-testid="change-outcome">
            <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm font-semibold text-ink" role="status">
              {name} ahora está en {done.toName}.
            </p>
            {distanceImpactText(done.result.official_distance_impact) ? (
              <p className="rounded-control border border-info-border bg-info-tint px-3 py-2 text-body-sm text-ink" data-testid="distance-impact">
                {distanceImpactText(done.result.official_distance_impact)}
              </p>
            ) : null}
            <p className="text-caption text-ink-60">El kit no cambia: es el mismo para toda la edición.</p>
            <ModalActions>
              <Button onClick={onClose}>Listo</Button>
            </ModalActions>
          </div>
        ) : (
          <ChangeForm row={row} editionId={editionId} modalities={modalities} categories={categories} pendingRef={pendingRef} onDone={setDone} />
        )}
      </ModalContent>
    </Modal>
  );
}

function ChangeForm({
  row,
  editionId,
  modalities,
  categories,
  pendingRef,
  onDone,
}: {
  row: ParticipantRowView;
  editionId: string;
  modalities: readonly ModalityOption[];
  categories: readonly CategoryOption[];
  pendingRef: React.MutableRefObject<boolean>;
  onDone: (done: { result: ChangeModalityResult; toName: string }) => void;
}) {
  const router = useRouter();
  const targets = targetModalities(modalities, row.modality.modality_id);
  const [modalityId, setModalityId] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<ChangeErrors>({});
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [key, setKey] = React.useState(() => newIdempotencyKey());
  const categoryChoices = selectableCategories(categories, modalityId);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pendingRef.current) return;
    const decision = validateChange({ modalityId, categoryId, reason }, row.modality.modality_id, categories);
    if (!decision.ok) {
      setErrors(decision.errors);
      return;
    }
    setErrors({});
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await apiFetch<unknown>(`/api/v1/admin/registrations/${row.registration_id}/change-modality`, { method: "POST", body: decision.body, idempotencyKey: key });
      if (!result.ok) {
        setFailure(result);
        if (!isTransientFailure(result)) setKey(newIdempotencyKey());
        if (result.code === "CONFLICT" || result.code === "CLOSURE_BLOCKED") router.refresh();
        return;
      }
      const parsed = changeModalityResultSchema.safeParse(result.data);
      if (!parsed.success || parsed.data.modality_id !== modalityId) {
        setFailure({ ok: false, status: 200, code: "INTERNAL_ERROR", message: "", requestId: null, details: {} });
        router.refresh();
        return;
      }
      onDone({ result: parsed.data, toName: targets.find((target) => target.modality_id === modalityId)?.name ?? "la modalidad nueva" });
      router.refresh();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const blocked = failure ? closureBlockedCopy(failure) : null;
  const specific = failure && !blocked ? changeFailureCopy(failure) : null;
  const view = failure ? describeFailure(failure) : null;
  const attendanceLink = attendanceHref(editionId);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <p className="text-body-sm text-ink-80">
        El servidor revisa el cupo de la modalidad nueva, que el participante cumpla sus reglas y que no falte ninguna respuesta del formulario. El kit no cambia.
      </p>
      {targets.length === 0 ? (
        <p role="alert" className="text-body-sm text-danger">
          No hay otra modalidad activa en esta edición.
        </p>
      ) : (
        <SelectField
          id="change-modality"
          label="Modalidad nueva"
          required
          value={modalityId}
          error={errors.modality}
          options={[{ value: "", label: "Elige una modalidad" }, ...targets.map((target) => ({ value: target.modality_id, label: target.name }))]}
          onChange={(event) => {
            setModalityId(event.target.value);
            setCategoryId("");
            setErrors((current) => ({ ...current, modality: undefined, category: undefined }));
          }}
        />
      )}
      {categoryChoices.length > 0 ? (
        <SelectField
          id="change-category"
          label="Categoría en la modalidad nueva"
          required
          value={categoryId}
          error={errors.category}
          options={[{ value: "", label: "Elige una categoría" }, ...categoryChoices.map((category) => ({ value: category.category_id, label: category.name }))]}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setErrors((current) => ({ ...current, category: undefined }));
          }}
        />
      ) : null}
      <TextareaField
        id="change-reason"
        label="Motivo"
        required
        value={reason}
        error={errors.reason}
        maxLength={500}
        helperText="Solo lo ve el staff; queda en la auditoría."
        onChange={(event) => {
          setReason(event.target.value);
          setErrors((current) => ({ ...current, reason: undefined }));
        }}
      />

      {failure && view ? (
        <div data-testid="change-failure">
          {blocked ? (
            <div className="rounded-control border border-danger-border bg-danger-tint px-3 py-2 text-body-sm text-ink" role="alert">
              <p className="font-semibold">{blocked.title}</p>
              <p>{blocked.message}</p>
              <p className="mt-1 text-caption text-ink-60">
                Referencia: <code className="font-mono select-all">{failure.requestId ?? "sin referencia"}</code>
              </p>
              {blocked.reopen === "finalization" && attendanceLink ? (
                <Link href={attendanceLink} prefetch={false} className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-2`}>
                  Ir a Asistencia
                </Link>
              ) : null}
            </div>
          ) : (
            <>
              <ErrorNoticeView
                view={specific ? { ...view, title: specific.title, message: specific.message, action: view.action === "retry" ? "retry" : "none" } : view}
                onRetry={() => void submit()}
              />
              {specific && specific.lines.length > 0 ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-6 text-body-sm text-ink-80">
                  {specific.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <ModalActions>
        <ModalClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Volver
          </Button>
        </ModalClose>
        <Button type="submit" loading={pending} disabled={targets.length === 0}>
          Cambiar modalidad
        </Button>
      </ModalActions>
    </form>
  );
}
