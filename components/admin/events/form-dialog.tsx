"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import { toast } from "@/components/ui/use-toast";
import { newIdempotencyKey, type ApiFailure, type ApiResult } from "@/lib/client/api";
import { RefusalNotice } from "@/components/admin/events/fields";

/**
 * Modal form for one staff write. Contract with the server (P3-E1 invariants):
 *  - nothing is shown as saved until the API answers ok; a failure keeps the dialog open with the actionable error;
 *  - one Idempotency-Key per open, reused by retries and renewed by the next open;
 *  - on success it closes, announces the outcome and re-renders the server page (`router.refresh`).
 * The caller owns validation and the request: `onSubmit` returns the ApiResult (or null when local validation
 * failed and nothing was sent).
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  successMessage,
  tone = "primary",
  onSubmit,
  children,
  widthClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  successMessage: string;
  tone?: "primary" | "danger";
  onSubmit: (context: { idempotencyKey: string }) => Promise<ApiResult<unknown> | null>;
  children: React.ReactNode;
  widthClassName?: string;
}) {
  const pendingRef = React.useRef(false);
  return (
    <Modal open={open} onOpenChange={(next) => (pendingRef.current ? undefined : onOpenChange(next))}>
      <ModalContent title={title} description={description} widthClassName={widthClassName}>
        <DialogBody
          onClose={() => onOpenChange(false)}
          submitLabel={submitLabel}
          successMessage={successMessage}
          tone={tone}
          onSubmit={onSubmit}
          pendingRef={pendingRef}
        >
          {children}
        </DialogBody>
      </ModalContent>
    </Modal>
  );
}

function DialogBody({
  onClose,
  submitLabel,
  successMessage,
  tone,
  onSubmit,
  pendingRef,
  children,
}: {
  onClose: () => void;
  submitLabel: string;
  successMessage: string;
  tone: "primary" | "danger";
  onSubmit: (context: { idempotencyKey: string }) => Promise<ApiResult<unknown> | null>;
  pendingRef: React.MutableRefObject<boolean>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<ApiFailure | null>(null);
  const [idempotencyKey] = React.useState(() => newIdempotencyKey());

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await onSubmit({ idempotencyKey });
      if (result === null) return;
      if (result.ok) {
        onClose();
        toast({ tone: "success", title: successMessage });
        router.refresh();
      } else {
        setFailure(result);
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      {children}
      {failure ? <RefusalNotice failure={failure} onRetry={() => void submit()} className="mt-2" /> : null}
      <ModalActions>
        <ModalClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            Cancelar
          </Button>
        </ModalClose>
        <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} loading={pending}>
          {submitLabel}
        </Button>
      </ModalActions>
    </form>
  );
}
