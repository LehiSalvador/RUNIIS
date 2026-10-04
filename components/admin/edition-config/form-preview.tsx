"use client";

import React from "react";
import { DynamicField } from "@/components/registration/dynamic-field";
import type { RegistrationContextForm } from "@/lib/shared/registration-context";
import type { FieldValue } from "@/components/registration/logic/model";

type PreviewField = RegistrationContextForm["fields"][number];

/**
 * "Así lo ve la persona": the form rendered with the SAME field component the participant's registration flow uses
 * (components/registration/dynamic-field), so labels, required marks, option lists and limits are exactly what the
 * participant gets. It is local to the browser: nothing typed here is sent or saved.
 */
export function FormPreview({ scope, fields }: { scope: string; fields: readonly PreviewField[] }) {
  const [values, setValues] = React.useState<Record<string, FieldValue | undefined>>({});

  if (fields.length === 0) {
    return (
      <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm text-ink-80" data-testid="form-preview-empty">
        Este formulario no tiene preguntas: la persona solo confirmará sus datos y los documentos legales.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid="form-preview">
      <p className="text-caption text-ink-60">Vista previa: lo que escribas aquí no se guarda. Un asterisco indica una pregunta obligatoria.</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.field_key} className={field.field_type === "TEXTAREA" || field.field_type === "MULTISELECT" ? "sm:col-span-2" : undefined}>
            <DynamicField
              scope={scope}
              field={field}
              value={values[field.field_key]}
              error={undefined}
              onChange={(next) => setValues((current) => ({ ...current, [field.field_key]: next }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
