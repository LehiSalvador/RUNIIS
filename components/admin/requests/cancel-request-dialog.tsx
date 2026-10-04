"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { apiFetch, newIdempotencyKey, type ApiFailure } from "@/lib/client/api";
import { cancelNotificationSchema, type CancelNotification } from "@/lib/shared/closure";
import { SelectField, TextareaField } from "@/components/admin/events/fields";
import { useReturnFocus } from "@/components/admin/use-return-focus";
import { RequestFailureNotice } from "@/components/admin/requests/failure-notice";
import { isTransientFailure } from "@/components/admin/requests/request-logic";
import {
  BUYER_EMAIL_NOTICE,
  REQUEST_CANCEL_CATEGORY_OPTIONS,
  buyerNotificationCopy,
  validateRequestCancel,
  type RequestCancelErrors,
} from "@/components/admin/requests/request-cancel-logic";
import { isRouteAvailable } from "@/components/shell/nav-availability";

/**
 * Cancel one PENDING request (staff, Master §72). The dialog says, before the click, that the buyer is emailed with the category chosen here
 * (the internal reason is never sent) and that no payment is handled on the platform. The cancellation is shown only after the server
 * confirmed it, together with the email outcome (queued, suppressed, no contact) and the follow-up task when one was opened.
 */
export function CancelRequestDialog({ requestId, reference, onClose }: { requestId: string; reference: string; onClose: () => void }) {
  const pendingRef = React.useRef(false);
  const returnFocus = useReturnFocus();
  const [done, setDone] = React.useState<CancelNotification | null>(null);
  return (
    <Modal open onOpenChange={(next) => (!next && !pendingRef.current ? onClose() : undefined)}>
      <ModalContent
        {...returnFocus}
        title={done ? "Solicitud cancelada" : `Cancelar la solicitud ${reference}`}
        description={done ? `Solicitud ${reference}` : "La solicitud se cancela y sus lugares apartados vuelven a estar disponibles."}
        widthClassName="max-w-xl"
      >
        {done ? <Outcome notification={done} onClose={onClose} /> : <CancelForm requestId={requestId} pendingRef={pendingRef} onDone={setDone} />}
      </ModalContent>
    </Modal>
  );
}

function CancelForm({
  requestId,
  pendingRef,
  onDone,
}: {
  requestId: string;
  pendingRef: React.MutableRefObject<boolean>;
  onDone: (notification: CancelNotification) => void;
}) {
  const router = useRouter();
  const [category, setCategory] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<RequestCancelErrors>({});
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [key, setKey] = React.useState(() => newIdempotencyKey());

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pendingRef.current) return;
    const decision = validateRequestCancel({ category, reason });
    if (!decision.ok) {
      setErrors(decision.errors);
      return;
    }
    setErrors({});
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await apiFetch<{ notification?: unknown }>(`/api/v1/admin/registration-requests/${requestId}/cancel`, {
        method: "POST",
        idempotencyKey: key,
        body: { reason: decision.reason, reason_category: decision.category },
      });
      if (!result.ok) {
        setFailure(result);
        // A refusal about the decision ends the intent; a lost connection / 429 / lock retry replays the same key.
        if (!isTransientFailure(result)) setKey(newIdempotencyKey());
        if (result.code === "CONFLICT") router.refresh();
        return;
      }
      const parsed = cancelNotificationSchema.safeParse(result.data?.notification);
      // The cancellation is committed (200). A missing or unreadable outcome reads as "unknown", never as success of the email.
      onDone(parsed.success ? parsed.data : { status: "unknown", follow_up_task_id: null });
      router.refresh();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink" data-testid="request-cancel-notice">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>{BUYER_EMAIL_NOTICE.email}</strong>
          </li>
          <li>
            <strong>{BUYER_EMAIL_NOTICE.payments}</strong>
          </li>
          <li>Los lugares apartados se liberan en cuanto el servidor confirma.</li>
        </ul>
      </div>
      <SelectField
        id="request-cancel-category"
        label="Categoría del motivo (la ve el comprador)"
        required
        value={category}
        error={errors.category}
        options={[{ value: "", label: "Elige una categoría" }, ...REQUEST_CANCEL_CATEGORY_OPTIONS]}
        onChange={(event) => {
          setCategory(event.target.value);
          setErrors((current) => ({ ...current, category: undefined }));
        }}
      />
      <TextareaField
        id="request-cancel-reason"
        label="Motivo (interno)"
        required
        value={reason}
        error={errors.reason}
        maxLength={500}
        helperText="Queda en la auditoría. El comprador no lo ve."
        onChange={(event) => {
          setReason(event.target.value);
          setErrors((current) => ({ ...current, reason: undefined }));
        }}
      />
      {failure ? <RequestFailureNotice failure={failure} onRetry={() => void submit()} /> : null}
      <ModalActions>
        <ModalClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Volver
          </Button>
        </ModalClose>
        <Button type="submit" variant="danger" loading={pending}>
          Cancelar solicitud
        </Button>
      </ModalActions>
    </form>
  );
}

function Outcome({ notification, onClose }: { notification: CancelNotification; onClose: () => void }) {
  const copy = buyerNotificationCopy(notification);
  const tasks = isRouteAvailable("/admin/tareas") && notification.follow_up_task_id ? `/admin/tareas?task=${notification.follow_up_task_id}` : null;
  return (
    <div className="flex flex-col gap-3" data-testid="request-cancel-outcome">
      <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm font-semibold text-ink" role="status">
        La solicitud quedó cancelada y los lugares apartados se liberaron.
      </p>
      <div
        className={`rounded-control border px-3 py-2 text-body-sm text-ink ${copy.tone === "warning" ? "border-warning-border bg-warning-tint" : copy.tone === "success" ? "border-success-border bg-success-tint" : "border-info-border bg-info-tint"}`}
        data-testid={`request-notification-${notification.status}`}
      >
        <p className="font-semibold">{copy.title}</p>
        <p>{copy.message}</p>
        {notification.follow_up_task_id ? (
          <p className="mt-1 text-caption text-ink-80">
            Tarea de seguimiento:{" "}
            {tasks ? (
              <Link href={tasks} prefetch={false} className="font-semibold underline underline-offset-4">
                abrir la tarea
              </Link>
            ) : (
              <code className="font-mono select-all" data-testid="request-follow-up-task">
                {notification.follow_up_task_id}
              </code>
            )}
          </p>
        ) : null}
      </div>
      <p className="text-caption text-ink-60">La plataforma no procesa pagos: no se reembolsa nada desde aquí.</p>
      <ModalActions>
        <Button onClick={onClose}>Listo</Button>
      </ModalActions>
    </div>
  );
}
