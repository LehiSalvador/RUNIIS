"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { newIdempotencyKey, type ApiFailure, type ApiResult } from "@/lib/client/api";
import { ErrorNoticeView } from "@/components/admin/error-notice";
import { describeFailure } from "@/components/admin/errors";

/**
 * Confirm dialog for destructive or consequential staff actions (ui-spec §3.1 Modal confirm pattern,
 * §3.13 bulk rule). It states the consequence and, for bulk actions, the exact affected `count`; an
 * optional reason (audit trail) can be required before the confirm button enables.
 *
 * Contract with the server: one Idempotency-Key per user intent. The key is minted when the dialog opens
 * and reused for retries after a failure, so a timeout/retry can never apply the action twice; it is
 * renewed on the next open. A failed call keeps the dialog open and shows the actionable error with its
 * support reference; success closes it and calls `onDone` (the caller refreshes its data).
 *
 * The caller owns `open` so any row action, menu item or button can open it.
 */
export type ConfirmContext = { reason: string; idempotencyKey: string };

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Plain-language consequence ("La solicitud se cancelará y el cupo se liberará."). */
  description: string;
  /** Exact number of affected records, shown prominently for bulk actions. */
  count?: number;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  reason?: { label: string; required?: boolean; minLength?: number; helper?: string };
  onConfirm: (context: ConfirmContext) => Promise<ApiResult<unknown>>;
  onDone?: (result: Extract<ApiResult<unknown>, { ok: true }>) => void;
};

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onOpenChange, title, description } = props;
  // The form (and with it the draft reason, the error and the idempotency key) only exists while the dialog is
  // open, so every open is a fresh intent without any reset effect.
  const pendingRef = React.useRef(false);
  return (
    <Modal open={open} onOpenChange={(next) => (pendingRef.current ? undefined : onOpenChange(next))}>
      <ModalContent title={title} description={description}>
        <ConfirmForm {...props} pendingRef={pendingRef} />
      </ModalContent>
    </Modal>
  );
}

function ConfirmForm({
  onOpenChange,
  count,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "primary",
  reason,
  onConfirm,
  onDone,
  pendingRef,
}: ConfirmDialogProps & { pendingRef: React.MutableRefObject<boolean> }) {
  const reasonId = React.useId();
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  // One key per intent: reused by every retry of this open, renewed by the next open.
  const [idempotencyKey] = React.useState(() => newIdempotencyKey());

  const minLength = reason?.minLength ?? (reason?.required ? 3 : 0);
  const reasonOk = !reason?.required || text.trim().length >= minLength;

  async function confirm() {
    if (pendingRef.current || !reasonOk) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await onConfirm({ reason: text.trim(), idempotencyKey });
      if (result.ok) {
        onOpenChange(false);
        onDone?.(result);
      } else {
        setFailure(result);
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <>
      {count !== undefined ? (
        <p className="mb-3 rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm font-semibold text-ink">
          Afecta a {count} {count === 1 ? "elemento" : "elementos"}.
        </p>
      ) : null}

      {reason ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={reasonId} className="text-label font-semibold text-ink">
            {reason.label}
            {reason.required ? <span aria-hidden="true" className="text-danger"> *</span> : null}
          </label>
          <textarea
            id={reasonId}
            value={text}
            rows={3}
            maxLength={500}
            required={reason.required}
            aria-describedby={reason.helper ? `${reasonId}-helper` : undefined}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-control border border-control bg-paper-raised px-4 py-2.5 text-body text-ink hover:border-ink-60 focus-visible:border-ink"
          />
          {reason.helper ? (
            <p id={`${reasonId}-helper`} className="text-caption text-ink-60">
              {reason.helper}
            </p>
          ) : null}
        </div>
      ) : null}

      {failure ? (
        <div className="mt-3">
          <ErrorNoticeView view={describeFailure(failure)} onRetry={confirm} />
        </div>
      ) : null}

      <ModalActions>
        <ModalClose asChild>
          <Button variant="secondary" disabled={pending}>
            {cancelLabel}
          </Button>
        </ModalClose>
        <Button variant={tone === "danger" ? "danger" : "primary"} loading={pending} disabled={!reasonOk} onClick={confirm}>
          {confirmLabel}
        </Button>
      </ModalActions>
    </>
  );
}
