"use client";

import React from "react";
import { cn } from "@/lib/client/cn";
import { FormField, fieldDescribedBy } from "@/components/ui/form-field";
import { TextField } from "@/components/ui/text-field";
import { ErrorNoticeView } from "@/components/admin/error-notice";
import { describeRefusal, failedCheckLabels } from "@/components/admin/events/form-logic";
import type { ApiFailure } from "@/lib/client/api";

/**
 * Small field wrappers for the staff forms. They compose the design-system FormField/TextField so labels,
 * helper/error slots and aria wiring are identical everywhere; native <select>/<input type=date|time> are used
 * on purpose (reliable on tablets, built-in keyboard and screen-reader behaviour).
 */
type BaseProps = {
  id: string;
  label: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

export function InputField({
  id,
  label,
  helperText,
  error,
  required,
  className,
  ...input
}: BaseProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "size">) {
  return (
    <FormField id={id} label={label} helperText={helperText} errorText={error} required={required} className={className}>
      <TextField
        id={id}
        invalid={Boolean(error)}
        aria-describedby={fieldDescribedBy(id, Boolean(error), Boolean(helperText))}
        aria-required={required || undefined}
        {...input}
      />
    </FormField>
  );
}

export function SelectField({
  id,
  label,
  helperText,
  error,
  required,
  className,
  options,
  ...select
}: BaseProps &
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id" | "className"> & {
    options: readonly { value: string; label: string }[];
  }) {
  return (
    <FormField id={id} label={label} helperText={helperText} errorText={error} required={required} className={className}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(id, Boolean(error), Boolean(helperText))}
        aria-required={required || undefined}
        className={cn(
          "h-11 w-full rounded-control border bg-paper-raised px-3 text-body text-ink transition-colors duration-fast ease-standard",
          error ? "border-danger" : "border-control hover:border-ink-60 focus-visible:border-ink",
          "disabled:cursor-not-allowed disabled:border-divider disabled:bg-paper-sunken disabled:text-ink-35",
        )}
        {...select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

export function TextareaField({
  id,
  label,
  helperText,
  error,
  required,
  className,
  ...area
}: BaseProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">) {
  return (
    <FormField id={id} label={label} helperText={helperText} errorText={error} required={required} className={className}>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(id, Boolean(error), Boolean(helperText))}
        className={cn(
          "w-full rounded-control border bg-paper-raised px-4 py-2.5 text-body text-ink",
          error ? "border-danger" : "border-control hover:border-ink-60 focus-visible:border-ink",
        )}
        {...area}
      />
    </FormField>
  );
}

/** A plain labelled native checkbox: 44px target, state conveyed by the control itself (never colour alone). */
export function CheckField({
  id,
  label,
  helperText,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  helperText?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className={cn("inline-flex min-h-11 items-center gap-3 text-body", disabled ? "text-ink-35" : "text-ink")}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={helperText ? `${id}-helper` : undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="size-5 shrink-0 accent-[var(--color-ink)]"
        />
        {label}
      </label>
      {helperText ? (
        <p id={`${id}-helper`} className="pl-8 text-caption text-ink-60">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A failed action: the shared actionable error plus the server's concrete reasons and, when the server named
 * them, the readiness items that are missing. Never renders raw server text.
 */
export function RefusalNotice({
  failure,
  onRetry,
  className,
}: {
  failure: Pick<ApiFailure, "code" | "requestId" | "details">;
  onRetry?: () => void;
  className?: string;
}) {
  const { view, reasons, failedChecks } = describeRefusal(failure);
  const missing = failedCheckLabels(failedChecks);
  return (
    <div className={className} data-testid="refusal-notice">
      <ErrorNoticeView view={view} onRetry={onRetry} />
      {reasons.length > 0 || missing.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-6 text-body-sm text-ink-80" aria-label="Motivos del rechazo">
          {reasons.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {missing.map((line) => (
            <li key={line}>Falta: {line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Field errors the server flagged (zod issues or the command's {field, reason}), keyed by form field name. */
export function serverFieldErrors(failure: Pick<ApiFailure, "code" | "details">): Record<string, string> {
  const { view, reasons } = describeRefusal({ ...failure, requestId: null });
  const out: Record<string, string> = {};
  const message = reasons[0] ?? "Revisa este valor.";
  for (const name of view.fields.keys()) out[name] = message;
  const field = (failure.details as { field?: unknown }).field;
  if (failure.code !== "VALIDATION_ERROR" && typeof field === "string" && (failure.details as { reason?: unknown }).reason === "taken") {
    out[field] = message;
  }
  return out;
}
