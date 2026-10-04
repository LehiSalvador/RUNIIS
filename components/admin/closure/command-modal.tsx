"use client";

import React from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions, ModalClose, ModalContent } from "@/components/ui/modal";
import type { ApiFailure } from "@/lib/client/api";
import { ErrorNoticeView } from "@/components/admin/error-notice";
import { describeFailure } from "@/components/admin/errors";
import { CheckField, TextareaField } from "@/components/admin/events/fields";
import { useReturnFocus } from "@/components/admin/use-return-focus";
import { useCommand } from "@/components/admin/closure/closure-api";
import { closureFailureCopy, type CommandKind } from "@/components/admin/closure/closure-logic";

/**
 * Shared pieces of the closure dialogs. A dialog states the consequence BEFORE the click, asks for what the server requires (reason, evidence,
 * an explicit scope confirmation), keeps one Idempotency-Key per intent (see useCommand) and, when the server refuses, explains why with the
 * support reference. It closes only after the server confirmed.
 */
export function CommandModal({
  title,
  description,
  onClose,
  locked,
  widthClassName = "max-w-xl",
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  /** A command is in flight: the dialog cannot be dismissed (the outcome would be lost). */
  locked: boolean;
  widthClassName?: string;
  children: React.ReactNode;
}) {
  const returnFocus = useReturnFocus();
  return (
    <Modal open onOpenChange={(next) => (!next && !locked ? onClose() : undefined)}>
      <ModalContent {...returnFocus} title={title} description={description} widthClassName={widthClassName}>
        {children}
      </ModalContent>
    </Modal>
  );
}

/** A refused command: specific copy when the contract names the refusal, the shared error model otherwise. The support reference is always shown. */
export function CommandFailure({
  failure,
  kind,
  onRetry,
}: {
  failure: ApiFailure;
  kind: CommandKind;
  onRetry: () => void;
}) {
  const copy = closureFailureCopy(failure, kind);
  const view = describeFailure(failure);
  if (!copy) {
    return (
      <div data-testid="command-failure" data-failure-code={failure.code}>
        <ErrorNoticeView view={view} onRetry={onRetry} />
      </div>
    );
  }
  const retryable = failure.code === "CONFLICT" && failure.details?.retryable === true;
  return (
    <div
      role="alert"
      data-testid="command-failure"
      data-failure-code={failure.code}
      className="rounded-control border border-warning-border bg-warning-tint px-3 py-2 text-body-sm text-ink"
    >
      <p className="font-semibold">{copy.title}</p>
      <p>{copy.message}</p>
      {copy.lines.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5" aria-label="Detalle del rechazo">
          {copy.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {copy.refresh ? <p className="mt-1 text-caption text-ink-80">Ya actualizamos la pantalla con el estado real.</p> : null}
      <p className="mt-1 text-caption text-ink-60">
        Referencia: <code className="font-mono select-all">{failure.requestId ?? "sin referencia"}</code>
      </p>
      {retryable ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

export type SimpleCommandProps<S extends z.ZodType> = {
  kind: CommandKind;
  title: string;
  description: string;
  /** The consequences, said before the click. */
  consequences: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  path: string;
  schema: S;
  buildBody: (reason: string) => unknown;
  reason?: { label: string; helper?: string; required: boolean };
  /** An explicit confirmation the operator must tick (the scope of a bulk step). */
  confirm?: { label: string };
  /** The exact number of affected records, shown prominently. */
  count?: { value: number; noun: string };
  onDone: (result: z.output<S>) => void;
  onRefusal: (failure: ApiFailure) => void;
  onClose: () => void;
};

/** One command with an optional reason and an optional scope confirmation (finalize, bulk no-show, reopen finalization, close, reopen closure). */
export function SimpleCommandDialog<S extends z.ZodType>(props: SimpleCommandProps<S>) {
  const { kind, title, description, consequences, confirmLabel, tone = "primary", path, schema, buildBody, reason, confirm, count, onDone, onRefusal, onClose } = props;
  const { run, pending, failure } = useCommand(onRefusal);
  const [text, setText] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  async function submit() {
    if (pending) return;
    const trimmed = text.trim();
    if (reason?.required && trimmed.length === 0) {
      setError("Escribe el motivo: queda en la auditoría.");
      return;
    }
    if (trimmed.length > 500) {
      setError("Máximo 500 caracteres.");
      return;
    }
    if (confirm && !confirmed) return;
    setError(undefined);
    const result = await run(path, buildBody(trimmed), schema);
    if (result !== null) {
      onClose();
      onDone(result);
    }
  }

  return (
    <CommandModal title={title} description={description} onClose={onClose} locked={pending}>
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {count ? (
          <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm font-semibold text-ink" data-testid="command-count">
            Afecta a {count.value} {count.noun}.
          </p>
        ) : null}
        <div className="text-body-sm text-ink" data-testid="command-consequences">
          {consequences}
        </div>
        {reason ? (
          <TextareaField
            id="command-reason"
            label={reason.label}
            required={reason.required}
            value={text}
            maxLength={500}
            error={error}
            helperText={reason.helper}
            onChange={(event) => {
              setText(event.target.value);
              setError(undefined);
            }}
          />
        ) : null}
        {confirm ? <CheckField id="command-confirm" label={confirm.label} checked={confirmed} onChange={setConfirmed} /> : null}
        {failure ? <CommandFailure failure={failure} kind={kind} onRetry={() => void submit()} /> : null}
        <ModalActions>
          <ModalClose asChild>
            <Button type="button" variant="secondary" disabled={pending}>
              Cancelar
            </Button>
          </ModalClose>
          <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} loading={pending} disabled={confirm ? !confirmed : false}>
            {confirmLabel}
          </Button>
        </ModalActions>
      </form>
    </CommandModal>
  );
}
