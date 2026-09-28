"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { PersonFieldsForm } from "@/components/account/person-fields-form";
import { apiFetch, newIdempotencyKey } from "@/lib/client/api";
import { errorMessage, invalidFields } from "@/lib/client/account-errors";
import {
  FIELD_MESSAGES,
  formatPhone,
  normalizePhone,
  validatePersonFields,
  type PersonField,
  type PersonFields,
} from "@/lib/client/person-fields";

type ContactFields = Pick<PersonFields, "phone_e164" | "emergency_contact_name" | "emergency_contact_phone_e164" | "emergency_contact_relationship">;
const EDITABLE: readonly (keyof ContactFields)[] = ["phone_e164", "emergency_contact_name", "emergency_contact_phone_e164", "emergency_contact_relationship"];
const IDENTITY_FIELDS: ReadonlySet<PersonField> = new Set(["full_name", "date_of_birth", "sex_code"]);

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

function normalizedValue(field: keyof ContactFields, value: string): string {
  return field.endsWith("phone_e164") ? (normalizePhone(value) ?? value) : collapse(value);
}

/**
 * Master §160 allowlist: after READY only phone + emergency fields are editable. PATCH sends just the
 * changed fields; the identity fields are not even rendered as inputs here.
 */
export function ProfileContactForm({ initial }: { initial: Record<keyof ContactFields, string | null> }) {
  const router = useRouter();
  const [saved, setSaved] = React.useState<ContactFields>(() => ({
    phone_e164: initial.phone_e164 ?? "",
    emergency_contact_name: initial.emergency_contact_name ?? "",
    emergency_contact_phone_e164: initial.emergency_contact_phone_e164 ?? "",
    emergency_contact_relationship: initial.emergency_contact_relationship ?? "",
  }));
  const [values, setValues] = React.useState<ContactFields>(() => ({
    phone_e164: formatPhone(initial.phone_e164),
    emergency_contact_name: initial.emergency_contact_name ?? "",
    emergency_contact_phone_e164: formatPhone(initial.emergency_contact_phone_e164),
    emergency_contact_relationship: initial.emergency_contact_relationship ?? "",
  }));
  const [errors, setErrors] = React.useState<Map<PersonField, string>>(new Map());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const elements = React.useRef(new Map<PersonField, HTMLElement | null>());

  const changes = Object.fromEntries(
    EDITABLE.filter((field) => normalizedValue(field, values[field]) !== saved[field]).map((field) => [field, normalizedValue(field, values[field])]),
  );
  const dirty = Object.keys(changes).length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !dirty) return;
    const all = validatePersonFields({ full_name: "xx", date_of_birth: "1990-01-01", sex_code: "F", ...values });
    const fieldErrors = new Map([...all].filter(([field]) => (EDITABLE as readonly string[]).includes(field)));
    setErrors(fieldErrors);
    if (fieldErrors.size > 0) {
      setFormError("Revisa los datos marcados.");
      elements.current.get(EDITABLE.find((field) => fieldErrors.has(field))!)?.focus();
      return;
    }
    setFormError(null);
    setPending(true);
    const result = await apiFetch("/api/v1/me/profile", { method: "PATCH", body: changes, idempotencyKey: newIdempotencyKey() });
    setPending(false);
    if (result.ok) {
      setSaved((current) => ({ ...current, ...(changes as Partial<ContactFields>) }));
      toast({ tone: "success", title: "Datos actualizados" });
      router.refresh();
      return;
    }
    const serverFields = invalidFields(result);
    const mapped = new Map<PersonField, string>();
    for (const field of serverFields.keys()) {
      if ((EDITABLE as readonly string[]).includes(field)) mapped.set(field as PersonField, FIELD_MESSAGES[field as PersonField]);
    }
    setErrors(mapped);
    setFormError(mapped.size > 0 ? "Revisa los datos marcados." : errorMessage(result));
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-card border border-divider bg-paper-raised p-5 md:p-6">
      {formError ? <Alert tone="danger" title={formError} className="mb-5" /> : null}
      <PersonFieldsForm
        idPrefix="profile"
        values={{ full_name: "", date_of_birth: null, sex_code: "", ...values }}
        errors={errors}
        hiddenFields={IDENTITY_FIELDS}
        onChange={(field, value) => {
          setValues((current) => ({ ...current, [field]: value ?? "" }));
          setFormError(null);
          if (errors.has(field)) setErrors((current) => new Map([...current].filter(([key]) => key !== field)));
        }}
        fieldRef={(field, element) => elements.current.set(field, element)}
        disabled={pending}
      />
      <div className="mt-4 flex flex-col-reverse gap-3 border-t border-divider pt-5 sm:flex-row sm:items-center sm:justify-end">
        {!dirty ? <p className="text-caption text-ink-60 sm:mr-auto">Sin cambios por guardar.</p> : null}
        <Button type="submit" loading={pending} disabled={!dirty} className="w-full sm:w-auto">
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
