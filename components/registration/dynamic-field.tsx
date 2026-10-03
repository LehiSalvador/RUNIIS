"use client";

import React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { FormField, fieldDescribedBy } from "@/components/ui/form-field";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/client/cn";
import type { RegistrationContextForm } from "@/lib/shared/registration-context";
import { fieldConstraints, fieldOptions, type FieldValue } from "./logic/model";

type Field = RegistrationContextForm["fields"][number];

/** Stable DOM id of a field's primary control, so the step can focus the first invalid one. */
export function fieldControlId(scope: string, fieldKey: string): string {
  return `${scope}-field-${fieldKey.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * Renders ONE field of the server's form definition (P2-B contract §2): TEXT, TEXTAREA, SELECT, MULTISELECT,
 * BOOLEAN, DATE, NUMBER. Labels are always visible and programmatically associated, the error is announced
 * and referenced by aria-describedby. No conditional logic exists in the definition, so none is invented.
 */
export function DynamicField({
  scope,
  field,
  value,
  error,
  onChange,
}: {
  scope: string;
  field: Field;
  value: FieldValue | undefined;
  error: string | undefined;
  onChange: (value: FieldValue | undefined) => void;
}) {
  const id = fieldControlId(scope, field.field_key);
  const options = fieldOptions(field);
  const constraints = fieldConstraints(field);
  const describedBy = fieldDescribedBy(id, Boolean(error), false);

  switch (field.field_type) {
    case "TEXT":
    case "NUMBER":
      return (
        <FormField id={id} label={field.label} required={field.required} errorText={error}>
          <TextField
            id={id}
            value={typeof value === "string" ? value : ""}
            invalid={Boolean(error)}
            aria-describedby={describedBy}
            required={field.required}
            maxLength={field.field_type === "TEXT" ? (constraints.max_length ?? 200) : 32}
            inputMode={field.field_type === "NUMBER" ? "decimal" : undefined}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
          />
        </FormField>
      );
    case "TEXTAREA":
      return (
        <FormField id={id} label={field.label} required={field.required} errorText={error}>
          <textarea
            id={id}
            rows={3}
            value={typeof value === "string" ? value : ""}
            maxLength={constraints.max_length ?? 2000}
            required={field.required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
            className={cn(
              "w-full rounded-control border bg-paper-raised px-4 py-3 text-body text-ink hover:border-ink-60 focus-visible:border-ink",
              error ? "border-danger" : "border-control",
            )}
          />
        </FormField>
      );
    case "SELECT": {
      const selected = typeof value === "string" ? options.find((option) => option.value === value) : undefined;
      return (
        <FormField id={id} label={field.label} required={field.required} errorText={error}>
          <Select value={selected?.value ?? ""} onValueChange={(next) => onChange(next)}>
            <SelectTrigger id={id} invalid={Boolean(error)} aria-describedby={describedBy} aria-required={field.required || undefined}>
              <SelectValue placeholder="Elige una opción">{selected?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      );
    }
    case "DATE":
      return (
        <FormField id={id} label={field.label} required={field.required} errorText={error}>
          <DateInput
            id={id}
            value={typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
            invalid={Boolean(error)}
            aria-describedby={describedBy}
            min={constraints.min_date}
            max={constraints.max_date}
            onValueChange={(iso, display) => onChange(iso ?? (display === "" ? undefined : display))}
          />
        </FormField>
      );
    case "BOOLEAN":
      return (
        <fieldset aria-describedby={describedBy} className="flex flex-col gap-1.5">
          <legend className="text-label font-semibold text-ink">
            {field.label}
            {field.required ? (
              <span aria-hidden="true" className="text-danger">
                {" "}
                *
              </span>
            ) : null}
          </legend>
          <RadioGroup
            aria-required={field.required || undefined}
            aria-invalid={error ? true : undefined}
            value={typeof value === "boolean" ? String(value) : ""}
            onValueChange={(next) => onChange(next === "true")}
            className="flex flex-wrap gap-x-6"
          >
            <RadioItem id={`${id}-yes`} value="true" label="Sí" />
            <RadioItem id={`${id}-no`} value="false" label="No" />
          </RadioGroup>
          <div className="min-h-[1.25rem] text-caption">
            {error ? (
              <p id={`${id}-error`} role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </fieldset>
      );
    case "MULTISELECT": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset aria-describedby={describedBy} className="flex flex-col gap-1">
          <legend className="text-label font-semibold text-ink">
            {field.label}
            {field.required ? (
              <span aria-hidden="true" className="text-danger">
                {" "}
                *
              </span>
            ) : null}
          </legend>
          <div className="flex flex-col">
            {options.map((option, index) => {
              const optionId = index === 0 ? id : `${id}-${index}`;
              return (
                <Checkbox
                  key={option.value}
                  id={optionId}
                  label={option.label}
                  checked={chosen.includes(option.value)}
                  onCheckedChange={(checked) => {
                    const next = checked === true ? [...chosen, option.value] : chosen.filter((item) => item !== option.value);
                    onChange(next.length > 0 ? next : undefined);
                  }}
                />
              );
            })}
          </div>
          <div className="min-h-[1.25rem] text-caption">
            {error ? (
              <p id={`${id}-error`} role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </fieldset>
      );
    }
  }
}
