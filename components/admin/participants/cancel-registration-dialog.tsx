"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { cancelRegistrationResultSchema, type CancelRegistrationResult } from "@/lib/shared/closure";
import { ErrorNoticeView } from "@/components/admin/error-notice";
import { describeFailure } from "@/components/admin/errors";
import { SelectField, TextareaField } from "@/components/admin/events/fields";
import { useReturnFocus } from "@/components/admin/use-return-focus";
import { isTransientFailure } from "@/components/admin/requests/request-logic";
import { isRouteAvailable } from "@/components/shell/nav-availability";
import {
  CANCEL_CATEGORY_OPTIONS,
  cancelFailureCopy,
  closureBlockedCopy,
  attendanceHref,
  displayName,
  notificationCopy,
  validateCancel,
  type CancelErrors,
  type ParticipantRowView,
} from "@/components/admin/participants/participant-logic";

/**
 * Cancel a CONFIRMED registration (OWN-04, Master §77). Allowed until attendance is finalized, at any time before that (before, during or
 * after the event). The dialog says, BEFORE the click, what the owner decided: the participant is always emailed (the buyer for a
 * Guest), only the category label reaches them (the free-text reason is internal) and no refund is processed on the platform. Nothing is
 * shown as cancelled until the server answers; the answer then shows the email outcome (queued, suppressed, no contact) and the
 * follow-up task when one was opened. After finalization the server answers CLOSURE_BLOCKED and the dialog explains the reopen path.
 */
export function CancelRegistrationDialog({
  row,
  editionId,
  editionClosed,
  onClose,
}: {
  row: ParticipantRowView;
  editionId: string;
  editionClosed: boolean;
  onClose: () => void;
}) {
  const pendingRef = React.useRef(false);
  const returnFocus = useReturnFocus();
  const [done, setDone] = React.useState<CancelRegistrationResult | null>(null);
  const name = displayName(row);
  const close = () => onClose();
  return (
    <Modal open onOpenChange={(next) => (!next && !pendingRef.current ? close() : undefined)}>
      <ModalContent
        {...returnFocus}
        title={done ? "Inscripción cancelada" : `Cancelar la inscripción de ${name}`}
        description={done ? `${row.registration_number} · ${name}` : `Inscripción ${row.registration_number}. La cancelación no se puede deshacer.`}
        widthClassName="max-w-xl"
      >
        {done ? (
          <Outcome row={row} result={done} onClose={close} />
        ) : (
          <CancelForm row={row} editionId={editionId} editionClosed={editionClosed} pendingRef={pendingRef} onDone={setDone} />
        )}
      </ModalContent>
    </Modal>
  );
}

function CancelForm({
  row,
  editionId,
  editionClosed,
  pendingRef,
  onDone,
}: {
  row: ParticipantRowView;
  editionId: string;
  editionClosed: boolean;
  pendingRef: React.MutableRefObject<boolean>;
  onDone: (result: CancelRegistrationResult) => void;
}) {
  const router = useRouter();
  const [category, setCategory] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<CancelErrors>({});
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [key, setKey] = React.useState(() => newIdempotencyKey());
  const emailGoesTo = row.participant_kind === "GUEST" ? "al comprador (un invitado no tiene cuenta)" : "al participante";

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pendingRef.current) return;
    const decision = validateCancel({ category, reason });
    if (!decision.ok) {
      setErrors(decision.errors);
      return;
    }
    setErrors({});
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await apiFetch<unknown>(`/api/v1/admin/registrations/${row.registration_id}/cancel`, { method: "POST", body: decision.body, idempotencyKey: key });
      if (!result.ok) {
        setFailure(result);
        // A refusal ends the intent (a corrected retry is a new decision); a lost connection / 429 / lock retry replays the same key.
        if (!isTransientFailure(result)) setKey(newIdempotencyKey());
        if (result.code === "CONFLICT" || result.code === "CLOSURE_BLOCKED") router.refresh();
        return;
      }
      const parsed = cancelRegistrationResultSchema.safeParse(result.data);
      if (!parsed.success || parsed.data.status !== "CANCELED") {
        setFailure({ ok: false, status: 200, code: "INTERNAL_ERROR", message: "", requestId: null, details: {} });
        router.refresh();
        return;
      }
      onDone(parsed.data);
      router.refresh();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const blocked = failure ? closureBlockedCopy(failure) : null;
  const specific = failure && !blocked ? cancelFailureCopy(failure) : null;
  const view = failure ? describeFailure(failure) : null;
  const attendanceLink = attendanceHref(editionId);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink" data-testid="own04-notice">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Se enviará un correo {emailGoesTo}</strong> con la categoría que elijas. El texto del motivo interno no se envía.
          </li>
          <li>
            <strong>La plataforma no procesa ningún reembolso.</strong> Si hubo un pago, se resuelve por fuera, directamente con la persona.
          </li>
          <li>El pase se cancela, el cupo se libera y el kit que no se haya entregado se libera.</li>
          <li>Solo se puede cancelar mientras la asistencia no esté finalizada.</li>
        </ul>
      </div>
      {editionClosed ? (
        <p className="rounded-control border border-danger-border bg-danger-tint px-3 py-2 text-body-sm text-ink" role="note">
          La edición está cerrada administrativamente: el servidor va a rechazar la cancelación hasta que un administrador global reabra el cierre.
        </p>
      ) : null}

      <SelectField
        id="cancel-category"
        label="Categoría del motivo (la ve el participante)"
        required
        value={category}
        error={errors.category}
        options={[{ value: "", label: "Elige una categoría" }, ...CANCEL_CATEGORY_OPTIONS]}
        onChange={(event) => {
          setCategory(event.target.value);
          setErrors((current) => ({ ...current, category: undefined }));
        }}
      />
      <TextareaField
        id="cancel-reason"
        label="Motivo interno"
        required
        value={reason}
        error={errors.reason}
        maxLength={500}
        helperText="Solo lo ve el staff; queda en la auditoría. No se envía al participante."
        onChange={(event) => {
          setReason(event.target.value);
          setErrors((current) => ({ ...current, reason: undefined }));
        }}
      />

      {failure && view ? (
        <div data-testid="cancel-failure">
          {blocked ? (
            <div className="rounded-control border border-danger-border bg-danger-tint px-3 py-2 text-body-sm text-ink" role="alert">
              <p className="font-semibold">{blocked.title}</p>
              <p>{blocked.message}</p>
              <p className="mt-1 text-caption text-ink-60">
                Referencia: <code className="font-mono select-all">{failure.requestId ?? "sin referencia"}</code>
              </p>
              {blocked.reopen === "finalization" ? (
                attendanceLink ? (
                  <Link href={attendanceLink} prefetch={false} className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-2`}>
                    Ir a Asistencia
                  </Link>
                ) : (
                  <p className="mt-1 text-caption text-ink-60">La sección de Asistencia llega en una próxima entrega; mientras tanto pide la reapertura a un administrador.</p>
                )
              ) : null}
            </div>
          ) : (
            <ErrorNoticeView
              view={specific ? { ...view, title: specific.title, message: specific.message, action: "reload" } : view}
              onRetry={() => void submit()}
            />
          )}
        </div>
      ) : null}

      <ModalActions>
        <ModalClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Volver
          </Button>
        </ModalClose>
        <Button type="submit" variant="danger" loading={pending}>
          Cancelar inscripción
        </Button>
      </ModalActions>
    </form>
  );
}

function Outcome({ row, result, onClose }: { row: ParticipantRowView; result: CancelRegistrationResult; onClose: () => void }) {
  const copy = notificationCopy(result.notification, row.participant_kind === "GUEST" ? "buyer" : "participant");
  const tasks = isRouteAvailable("/admin/tareas") && result.notification.follow_up_task_id ? `/admin/tareas?task=${result.notification.follow_up_task_id}` : null;
  return (
    <div className="flex flex-col gap-3" data-testid="cancel-outcome">
      <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm font-semibold text-ink" role="status">
        La inscripción {result.registration_number} quedó cancelada. El cupo se liberó y el pase ya no es válido.
      </p>
      <div
        className={`rounded-control border px-3 py-2 text-body-sm text-ink ${copy.tone === "warning" ? "border-warning-border bg-warning-tint" : copy.tone === "success" ? "border-success-border bg-success-tint" : "border-info-border bg-info-tint"}`}
        data-testid={`notification-${result.notification.status}`}
      >
        <p className="font-semibold">{copy.title}</p>
        <p>{copy.message}</p>
        {result.notification.follow_up_task_id ? (
          <p className="mt-1 text-caption text-ink-80">
            Tarea de seguimiento:{" "}
            {tasks ? (
              <Link href={tasks} prefetch={false} className="font-semibold underline underline-offset-4">
                abrir la tarea
              </Link>
            ) : (
              <code className="font-mono select-all" data-testid="follow-up-task">
                {result.notification.follow_up_task_id}
              </code>
            )}
          </p>
        ) : null}
      </div>
      <p className="text-caption text-ink-60">No se procesó ningún reembolso en la plataforma.</p>
      <ModalActions>
        <Button onClick={onClose}>Listo</Button>
      </ModalActions>
    </div>
  );
}
