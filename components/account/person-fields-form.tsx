"use client";

import React from "react";
import { DateInput } from "@/components/ui/date-input";
import { FormField, fieldDescribedBy } from "@/components/ui/form-field";
import { RadioGroup, RadioItem } from "@/components/ui/radio-group";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/client/cn";
import { RELATIONSHIP_SUGGESTIONS, SEX_OPTIONS, type PersonField, type PersonFields } from "@/lib/client/person-fields";

/**
 * The seven identity/contact fields (form spec 10.2 / 10.4), in the verbatim order. Controlled:
 * the parent owns values/errors and focuses the first invalid field via `fieldRef`. `lockedFields`
 * render read-only (e.g. a Guest's identity once used in a request). `afterDateOfBirth` is where the
 * caller renders the age branching (minor notice, under-15 stop) right under the birth date.
 */
export type PersonFieldsFormProps = {
  idPrefix: string;
  values: PersonFields;
  errors: Map<PersonField, string>;
  onChange: (field: PersonField, value: string | null) => void;
  lockedFields?: ReadonlySet<PersonField>;
  hiddenFields?: ReadonlySet<PersonField>;
  afterDateOfBirth?: React.ReactNode;
  fieldRef?: (field: PersonField, element: HTMLElement | null) => void;
  labels?: Partial<Record<"full_name" | "date_of_birth" | "phone_e164", string>>;
  maxDate?: string;
  disabled?: boolean;
};

export function PersonFieldsForm({
  idPrefix,
  values,
  errors,
  onChange,
  lockedFields,
  hiddenFields,
  afterDateOfBirth,
  fieldRef,
  labels,
  maxDate,
  disabled,
}: PersonFieldsFormProps) {
  const id = (field: PersonField) => `${idPrefix}-${field}`;
  const locked = (field: PersonField) => disabled || Boolean(lockedFields?.has(field));
  const shown = (field: PersonField) => !hiddenFields?.has(field);
  const lockHelper = "No se puede cambiar porque ya participa en una solicitud.";
  const describedBy = (field: PersonField, hasHelper = false) => fieldDescribedBy(id(field), errors.has(field), hasHelper);
  const ref = (field: PersonField) => (element: HTMLElement | null) => fieldRef?.(field, element);

  const phoneHelper = "10 dígitos. Si es de otro país, escribe + y la lada.";

  return (
    <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
      {shown("full_name") ? (
        <FormField
          id={id("full_name")}
          label={labels?.full_name ?? "Nombre completo"}
          required
          errorText={errors.get("full_name")}
          helperText={lockedFields?.has("full_name") ? lockHelper : "Como aparece en tu identificación."}
          className="md:col-span-2"
        >
          <TextField
            id={id("full_name")}
            ref={ref("full_name")}
            autoComplete="name"
            value={values.full_name}
            readOnly={locked("full_name")}
            disabled={locked("full_name")}
            invalid={errors.has("full_name")}
            aria-describedby={describedBy("full_name", true)}
            aria-required="true"
            onChange={(event) => onChange("full_name", event.target.value)}
          />
        </FormField>
      ) : null}

      {shown("date_of_birth") ? (
        <div className="md:col-span-2">
          <FormField
            id={id("date_of_birth")}
            label={labels?.date_of_birth ?? "Fecha de nacimiento"}
            required
            errorText={errors.get("date_of_birth")}
            helperText={lockedFields?.has("date_of_birth") ? lockHelper : "Formato dd/mm/aaaa."}
            className="md:max-w-xs"
          >
            <DateInput
              id={id("date_of_birth")}
              ref={ref("date_of_birth")}
              value={values.date_of_birth ?? ""}
              max={maxDate}
              disabled={locked("date_of_birth")}
              invalid={errors.has("date_of_birth")}
              aria-describedby={describedBy("date_of_birth", true)}
              aria-required="true"
              onValueChange={(iso) => onChange("date_of_birth", iso)}
            />
          </FormField>
          {afterDateOfBirth}
        </div>
      ) : null}

      {shown("sex_code") ? (
        <fieldset className="md:col-span-2" aria-describedby={errors.has("sex_code") ? `${id("sex_code")}-error` : undefined}>
          <legend className="text-label font-semibold text-ink">
            Sexo<span aria-hidden="true" className="text-danger"> *</span>
          </legend>
          <RadioGroup
            ref={ref("sex_code")}
            value={values.sex_code}
            onValueChange={(value) => onChange("sex_code", value)}
            disabled={locked("sex_code")}
            aria-required="true"
            aria-invalid={errors.has("sex_code") || undefined}
            className="mt-1 flex flex-wrap gap-x-6"
          >
            {SEX_OPTIONS.map((option) => (
              <RadioItem key={option.value} id={`${id("sex_code")}-${option.value}`} value={option.value} label={option.label} />
            ))}
          </RadioGroup>
          <div className="min-h-[1.25rem] text-caption">
            {errors.has("sex_code") ? (
              <p id={`${id("sex_code")}-error`} role="alert" className="text-danger">
                {errors.get("sex_code")}
              </p>
            ) : lockedFields?.has("sex_code") ? (
              <p className="text-ink-60">{lockHelper}</p>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {shown("phone_e164") ? (
        <FormField
          id={id("phone_e164")}
          label={labels?.phone_e164 ?? "Teléfono"}
          required
          errorText={errors.get("phone_e164")}
          helperText={phoneHelper}
        >
          <TextField
            id={id("phone_e164")}
            ref={ref("phone_e164")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="81 1234 5678"
            value={values.phone_e164}
            disabled={locked("phone_e164")}
            invalid={errors.has("phone_e164")}
            aria-describedby={describedBy("phone_e164", true)}
            aria-required="true"
            onChange={(event) => onChange("phone_e164", event.target.value)}
          />
        </FormField>
      ) : null}

      {shown("emergency_contact_name") ? (
        <>
          <div className={cn("md:col-span-2", shown("phone_e164") && "mt-2 border-t border-divider pt-4")}>
            <p className="text-body font-semibold text-ink">Contacto de emergencia</p>
            <p className="text-body-sm text-ink-60">Solo lo usa el equipo del evento si ocurre un incidente.</p>
          </div>

          <FormField
            id={id("emergency_contact_name")}
            label="Nombre del contacto"
            required
            errorText={errors.get("emergency_contact_name")}
          >
            <TextField
              id={id("emergency_contact_name")}
              ref={ref("emergency_contact_name")}
              autoComplete="off"
              value={values.emergency_contact_name}
              disabled={locked("emergency_contact_name")}
              invalid={errors.has("emergency_contact_name")}
              aria-describedby={describedBy("emergency_contact_name")}
              aria-required="true"
              onChange={(event) => onChange("emergency_contact_name", event.target.value)}
            />
          </FormField>

          <FormField
            id={id("emergency_contact_phone_e164")}
            label="Teléfono del contacto"
            required
            errorText={errors.get("emergency_contact_phone_e164")}
            helperText={phoneHelper}
          >
            <TextField
              id={id("emergency_contact_phone_e164")}
              ref={ref("emergency_contact_phone_e164")}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="81 1234 5678"
              value={values.emergency_contact_phone_e164}
              disabled={locked("emergency_contact_phone_e164")}
              invalid={errors.has("emergency_contact_phone_e164")}
              aria-describedby={describedBy("emergency_contact_phone_e164", true)}
              aria-required="true"
              onChange={(event) => onChange("emergency_contact_phone_e164", event.target.value)}
            />
          </FormField>

          <FormField
            id={id("emergency_contact_relationship")}
            label="Relación con el contacto"
            required
            errorText={errors.get("emergency_contact_relationship")}
            helperText="Por ejemplo: Madre, Pareja, Amistad."
          >
            <TextField
              id={id("emergency_contact_relationship")}
              ref={ref("emergency_contact_relationship")}
              list={`${idPrefix}-relationship-options`}
              autoComplete="off"
              maxLength={60}
              value={values.emergency_contact_relationship}
              disabled={locked("emergency_contact_relationship")}
              invalid={errors.has("emergency_contact_relationship")}
              aria-describedby={describedBy("emergency_contact_relationship", true)}
              aria-required="true"
              onChange={(event) => onChange("emergency_contact_relationship", event.target.value)}
            />
          </FormField>
          <datalist id={`${idPrefix}-relationship-options`}>
            {RELATIONSHIP_SUGGESTIONS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </>
      ) : null}
    </div>
  );
}
