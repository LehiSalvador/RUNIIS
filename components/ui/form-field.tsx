import React from "react";
import { cn } from "@/lib/client/cn";

/**
 * ui-spec §3.1 FormFieldError: label, control slot, helper text, error text, with a reserved
 * fixed-height helper slot so an error never shifts layout. The error id is meant to be passed as
 * `aria-describedby` on the control (see TextField/Select/etc for the wiring).
 */
export type FormFieldProps = {
  id: string;
  label: string;
  helperText?: string;
  errorText?: string;
  required?: boolean;
  hideLabel?: boolean;
  children: React.ReactNode;
  className?: string;
};

export function FormField({
  id,
  label,
  helperText,
  errorText,
  required,
  hideLabel,
  children,
  className,
}: FormFieldProps) {
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className={cn("text-label font-body font-semibold text-ink", hideLabel && "sr-only")}
      >
        {label}
        {required ? <span aria-hidden="true" className="text-danger"> *</span> : null}
      </label>
      {children}
      <div className="min-h-[1.25rem] text-caption">
        {errorText ? (
          <p id={errorId} role="alert" className="text-danger">
            {errorText}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-ink-60">
            {helperText}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function fieldDescribedBy(id: string, hasError: boolean, hasHelper: boolean): string | undefined {
  if (hasError) return `${id}-error`;
  if (hasHelper) return `${id}-helper`;
  return undefined;
}
