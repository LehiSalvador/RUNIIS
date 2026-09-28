"use client";

import React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PersonFieldsForm } from "@/components/account/person-fields-form";
import { apiFetch, newIdempotencyKey } from "@/lib/client/api";
import { errorMessage, invalidFields } from "@/lib/client/account-errors";
import {
  FIELD_MESSAGES,
  PERSON_FIELD_ORDER,
  UNDER_MIN_AGE_MESSAGE,
  ageBand,
  ageOn,
  formatPhone,
  todayInBusinessZone,
  toPersonPayload,
  validatePersonFields,
  type PersonField,
  type PersonFields,
} from "@/lib/client/person-fields";

export type PlatformLegalVersions = { terms: number | null; privacy: number | null };

type OnboardingProfile = {
  full_name: string | null;
  date_of_birth: string | null;
  sex_code: "F" | "M" | "X" | null;
  phone_e164: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone_e164: string | null;
  emergency_contact_relationship: string | null;
};

const AFTER_BIRTH_DATE: ReadonlySet<PersonField> = new Set(["sex_code", "phone_e164", "emergency_contact_name", "emergency_contact_phone_e164", "emergency_contact_relationship"]);

export function OnboardingForm({ profile, next, legal }: { profile: OnboardingProfile; next: string; legal: PlatformLegalVersions }) {
  const [values, setValues] = React.useState<PersonFields>({
    full_name: profile.full_name ?? "",
    date_of_birth: profile.date_of_birth,
    sex_code: profile.sex_code ?? "",
    phone_e164: formatPhone(profile.phone_e164),
    emergency_contact_name: profile.emergency_contact_name ?? "",
    emergency_contact_phone_e164: formatPhone(profile.emergency_contact_phone_e164),
    emergency_contact_relationship: profile.emergency_contact_relationship ?? "",
  });
  const [errors, setErrors] = React.useState<Map<PersonField, string>>(new Map());
  const [legalAccepted, setLegalAccepted] = React.useState(false);
  const [legalError, setLegalError] = React.useState<string | undefined>();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const fieldElements = React.useRef(new Map<PersonField, HTMLElement | null>());
  const legalRef = React.useRef<HTMLButtonElement>(null);

  const today = todayInBusinessZone();
  const band = values.date_of_birth && values.date_of_birth <= today ? ageBand(ageOn(values.date_of_birth, today)) : null;
  const legalRequired = legal.terms !== null || legal.privacy !== null;

  function change(field: PersonField, value: string | null) {
    setValues((current) => ({ ...current, [field]: value ?? (field === "date_of_birth" ? null : "") }));
    setFormError(null);
    if (errors.has(field)) {
      setErrors((current) => {
        const nextErrors = new Map(current);
        nextErrors.delete(field);
        return nextErrors;
      });
    }
  }

  function focusFirst(fieldErrors: Map<PersonField, string>) {
    const first = PERSON_FIELD_ORDER.find((field) => fieldErrors.has(field));
    if (first) fieldElements.current.get(first)?.focus();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || band === "UNDER_MIN") return;
    const fieldErrors = validatePersonFields(values, today);
    const legalMissing = legalRequired && !legalAccepted;
    setErrors(fieldErrors);
    setLegalError(legalMissing ? "Debes aceptar los documentos para continuar." : undefined);
    if (fieldErrors.size > 0 || legalMissing) {
      setFormError("Revisa los datos marcados.");
      if (fieldErrors.size > 0) focusFirst(fieldErrors);
      else legalRef.current?.focus();
      return;
    }

    setFormError(null);
    setPending(true);
    const result = await apiFetch("/api/v1/me/onboarding", {
      method: "POST",
      body: toPersonPayload(values),
      idempotencyKey: newIdempotencyKey(),
    });
    if (result.ok || result.code === "CONFLICT") {
      window.location.assign(next);
      return;
    }
    setPending(false);
    if (result.code === "IDENTITY_LOCKED" || result.code === "ACCOUNT_BANNED" || result.code === "FORBIDDEN") {
      window.location.reload();
      return;
    }
    const serverFields = invalidFields(result);
    if (serverFields.size > 0) {
      const mapped = new Map<PersonField, string>();
      for (const [field, reason] of serverFields) {
        if ((PERSON_FIELD_ORDER as readonly string[]).includes(field)) {
          const key = field as PersonField;
          mapped.set(key, reason === "UNDER_MIN_AGE" ? UNDER_MIN_AGE_MESSAGE : FIELD_MESSAGES[key]);
        }
      }
      setErrors(mapped);
      setFormError("Revisa los datos marcados.");
      focusFirst(mapped);
      return;
    }
    setFormError(errorMessage(result));
  }

  return (
    <form onSubmit={submit} noValidate aria-describedby={formError ? "onboarding-form-error" : undefined}>
      {formError ? (
        <div id="onboarding-form-error" className="mb-6">
          <Alert tone="danger" title={formError} />
        </div>
      ) : null}

      <PersonFieldsForm
        idPrefix="onboarding"
        values={values}
        errors={errors}
        onChange={change}
        maxDate={today}
        hiddenFields={band === "UNDER_MIN" ? AFTER_BIRTH_DATE : undefined}
        fieldRef={(field, element) => fieldElements.current.set(field, element)}
        afterDateOfBirth={
          band === "MINOR" ? (
            <Alert tone="info" title="Tu perfil será de corredor menor de edad" className="mb-4">
              Entre 15 y 17 años puedes tener cuenta, pero no aparecerás en búsquedas ni en rankings públicos, y para
              inscribirte necesitarás un adulto responsable vinculado a tu cuenta.
            </Alert>
          ) : band === "UNDER_MIN" ? (
            <Alert tone="danger" title="RUNIIS requiere tener al menos 15 años para crear un perfil" className="mb-4">
              Si eres madre, padre o tutor, entra con tu propia cuenta y registra al menor como invitado. Así tú quedas
              como su adulto responsable.
            </Alert>
          ) : null
        }
      />

      {band !== "UNDER_MIN" ? (
        <>
          {legalRequired ? (
            <div className="mt-4 border-t border-divider pt-5">
              <div className="flex items-start gap-1">
                <Checkbox
                  ref={legalRef}
                  id="onboarding-legal"
                  checked={legalAccepted}
                  onCheckedChange={(checked) => {
                    setLegalAccepted(checked === true);
                    if (checked === true) setLegalError(undefined);
                  }}
                  aria-invalid={legalError ? true : undefined}
                  aria-describedby={legalError ? "onboarding-legal-error" : undefined}
                  className="-ml-3 -mt-2.5"
                />
                <label htmlFor="onboarding-legal" className="text-body text-ink">
                  Acepto{" "}
                  {legal.terms !== null ? (
                    <a href="/legal/terminos" target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
                      los Términos y condiciones (versión {legal.terms})
                    </a>
                  ) : null}
                  {legal.terms !== null && legal.privacy !== null ? " y " : null}
                  {legal.privacy !== null ? (
                    <a href="/legal/privacidad" target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
                      el Aviso de privacidad (versión {legal.privacy})
                    </a>
                  ) : null}
                  .
                </label>
              </div>
              <div className="min-h-[1.25rem] pl-8 text-caption">
                {legalError ? (
                  <p id="onboarding-legal-error" role="alert" className="text-danger">
                    {legalError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-divider pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-caption text-ink-60">Tu nombre, fecha de nacimiento y sexo no se podrán cambiar después desde tu cuenta.</p>
            <Button type="submit" size="lg" loading={pending} className="w-full sm:w-auto">
              Guardar y continuar
            </Button>
          </div>
        </>
      ) : null}
    </form>
  );
}
