"use client";

import React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import type { ApiFailure } from "@/lib/client/api";
import { errorMessage } from "@/lib/client/account-errors";
import { useReturnFocus } from "@/lib/client/focus";

/**
 * Confirm step for destructive/irreversible account actions (ui-spec §3.1 Modal: consequence first).
 * `onConfirm` resolves to null on success (the dialog closes) or to the failure, shown inline so the
 * person can retry or cancel. The confirm button is disabled while in flight (double-submit guard).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "danger",
  onConfirm,
  describeFailure = errorMessage,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<ApiFailure | null>;
  describeFailure?: (failure: ApiFailure) => string;
  children?: React.ReactNode;
}) {
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const returnFocus = useReturnFocus(open);

  function change(next: boolean) {
    if (pending) return;
    if (!next) setFailure(null);
    onOpenChange(next);
  }

  async function confirm() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    const result = await onConfirm();
    setPending(false);
    if (result) setFailure(result);
    else onOpenChange(false);
  }

  return (
    <Modal open={open} onOpenChange={change}>
      <ModalContent title={title} description={description} onCloseAutoFocus={returnFocus}>
        {children}
        {failure ? (
          <Alert tone="danger" title="No se pudo completar." className="mt-4">
            {describeFailure(failure)}
          </Alert>
        ) : null}
        <ModalActions>
          <ModalClose asChild>
            <Button variant="secondary" disabled={pending}>
              Volver
            </Button>
          </ModalClose>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={pending} onClick={confirm}>
            {confirmLabel}
          </Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
