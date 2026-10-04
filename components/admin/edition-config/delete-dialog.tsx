"use client";

import React from "react";
import { apiFetch } from "@/lib/client/api";
import { FormDialog } from "@/components/admin/events/form-dialog";

/**
 * Confirmation for removing one configuration record (location, agenda entry, content block). It is a FormDialog so a refusal shows the
 * server's concrete reason (for example "in use") next to the actionable error, instead of only the generic conflict text.
 */
export function DeleteDialog({
  title,
  description,
  endpoint,
  confirmLabel,
  successMessage,
  onClose,
}: {
  title: string;
  description: string;
  endpoint: string;
  confirmLabel: string;
  successMessage: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description={description}
      submitLabel={confirmLabel}
      successMessage={successMessage}
      tone="danger"
      onSubmit={() => apiFetch(endpoint, { method: "DELETE" })}
    >
      <p className="text-body-sm text-ink-80">Esta acción no se puede deshacer.</p>
    </FormDialog>
  );
}
