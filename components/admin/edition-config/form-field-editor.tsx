"use client";

import React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckField, InputField, SelectField } from "@/components/admin/events/fields";
import {
  FIELD_TYPE_OPTIONS,
  MAX_FORM_FIELDS,
  MAX_OPTIONS,
  fieldKeyFromLabel,
  hasOptions,
  moveItem,
  newFieldDraft,
  newOption,
  optionValueFromLabel,
  type FieldDraft,
  type FieldDraftErrors,
  type FormFieldType,
} from "@/components/admin/edition-config/form-field-logic";

/**
 * The editable list of questions of a DRAFT registration form. Every control is a native, labelled input (keyboard and tablet
 * friendly); reordering is done with move buttons, never drag only. The list is controlled by the parent, which owns saving.
 */
export function FieldEditorList({
  scope,
  drafts,
  errors,
  onChange,
}: {
  scope: string;
  drafts: readonly FieldDraft[];
  errors: Record<string, FieldDraftErrors>;
  onChange: (next: FieldDraft[]) => void;
}) {
  const update = (uid: string, patch: Partial<FieldDraft>) => onChange(drafts.map((draft) => (draft.uid === uid ? { ...draft, ...patch } : draft)));

  return (
    <div className="flex flex-col gap-3">
      {drafts.length === 0 ? (
        <p className="rounded-control border border-divider bg-paper-sunken px-3 py-2 text-body-sm text-ink-80" data-testid="fields-empty">
          Sin preguntas extra. Un formulario vacío es válido: la persona solo confirmará sus datos y los documentos legales.
        </p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Preguntas del formulario">
          {drafts.map((draft, index) => (
            <FieldCard
              key={draft.uid}
              scope={scope}
              index={index}
              count={drafts.length}
              draft={draft}
              errors={errors[draft.uid] ?? {}}
              onPatch={(patch) => update(draft.uid, patch)}
              onMove={(delta) => onChange(moveItem(drafts, index, index + delta))}
              onRemove={() => onChange(drafts.filter((entry) => entry.uid !== draft.uid))}
            />
          ))}
        </ol>
      )}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={drafts.length >= MAX_FORM_FIELDS}
          onClick={() => onChange([...drafts, newFieldDraft()])}
        >
          <Plus className="size-4" aria-hidden="true" />
          Agregar pregunta
        </Button>
        {drafts.length >= MAX_FORM_FIELDS ? <span className="ml-3 text-caption text-ink-60">Máximo {MAX_FORM_FIELDS} preguntas.</span> : null}
      </div>
    </div>
  );
}

function FieldCard({
  scope,
  index,
  count,
  draft,
  errors,
  onPatch,
  onMove,
  onRemove,
}: {
  scope: string;
  index: number;
  count: number;
  draft: FieldDraft;
  errors: FieldDraftErrors;
  onPatch: (patch: Partial<FieldDraft>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = `${scope}-${draft.uid}`;
  const number = index + 1;
  const type = draft.field_type;

  return (
    <li className="rounded-control border border-divider p-3" data-field-key={draft.field_key || undefined} data-testid="form-field-card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm font-bold text-ink">Pregunta {number}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="size-4" aria-hidden="true" />
            <span className="sr-only">Subir la pregunta {number}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="size-4" aria-hidden="true" />
            <span className="sr-only">Bajar la pregunta {number}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden="true" />
            <span className="sr-only">Quitar la pregunta {number}</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <InputField
          id={`${id}-label`}
          name={`label-${index}`}
          label="Pregunta (como la verá la persona)"
          required
          value={draft.label}
          error={errors.label}
          maxLength={160}
          autoComplete="off"
          onChange={(event) => {
            const label = event.target.value;
            onPatch({ label, ...(draft.keyTouched ? {} : { field_key: fieldKeyFromLabel(label) }) });
          }}
        />
        <InputField
          id={`${id}-key`}
          name={`field_key-${index}`}
          label="Clave interna"
          required
          value={draft.field_key}
          error={errors.field_key}
          helperText="Identifica la respuesta en los reportes. No se muestra a la persona."
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onPatch({ field_key: event.target.value, keyTouched: true })}
        />
        <SelectField
          id={`${id}-type`}
          name={`field_type-${index}`}
          label="Tipo de respuesta"
          value={type}
          options={FIELD_TYPE_OPTIONS}
          onChange={(event) => {
            const next = event.target.value as FormFieldType;
            onPatch({ field_type: next, options: hasOptions(next) && draft.options.length === 0 ? [newOption()] : draft.options });
          }}
        />
        <div className="flex flex-col justify-end pb-1.5">
          <CheckField id={`${id}-required`} label="Respuesta obligatoria" checked={draft.required} onChange={(required) => onPatch({ required })} />
          <CheckField
            id={`${id}-sensitive`}
            label="Dato sensible"
            helperText="Se protege como dato personal sensible."
            checked={draft.sensitivity === "SENSITIVE"}
            onChange={(checked) => onPatch({ sensitivity: checked ? "SENSITIVE" : "NORMAL" })}
          />
        </div>
      </div>

      {type === "TEXT" || type === "TEXTAREA" ? (
        <div className="grid gap-x-4 sm:grid-cols-2">
          <InputField id={`${id}-minlen`} name={`min_length-${index}`} label="Mínimo de caracteres" inputMode="numeric" value={draft.min_length} error={errors.min_length} autoComplete="off" onChange={(event) => onPatch({ min_length: event.target.value })} />
          <InputField id={`${id}-maxlen`} name={`max_length-${index}`} label="Máximo de caracteres" inputMode="numeric" value={draft.max_length} error={errors.max_length} helperText={type === "TEXT" ? "Hasta 200." : "Hasta 2000."} autoComplete="off" onChange={(event) => onPatch({ max_length: event.target.value })} />
        </div>
      ) : null}

      {type === "NUMBER" ? (
        <div className="grid gap-x-4 sm:grid-cols-3">
          <InputField id={`${id}-min`} name={`min-${index}`} label="Valor mínimo" inputMode="decimal" value={draft.min} error={errors.min} autoComplete="off" onChange={(event) => onPatch({ min: event.target.value })} />
          <InputField id={`${id}-max`} name={`max-${index}`} label="Valor máximo" inputMode="decimal" value={draft.max} error={errors.max} autoComplete="off" onChange={(event) => onPatch({ max: event.target.value })} />
          <div className="flex items-end pb-1.5">
            <CheckField id={`${id}-integer`} label="Solo enteros" checked={draft.integer} onChange={(integer) => onPatch({ integer })} />
          </div>
        </div>
      ) : null}

      {type === "DATE" ? (
        <div className="grid gap-x-4 sm:grid-cols-2">
          <InputField id={`${id}-mindate`} name={`min_date-${index}`} type="date" label="Fecha mínima" value={draft.min_date} error={errors.min_date} onChange={(event) => onPatch({ min_date: event.target.value })} />
          <InputField id={`${id}-maxdate`} name={`max_date-${index}`} type="date" label="Fecha máxima" value={draft.max_date} error={errors.max_date} onChange={(event) => onPatch({ max_date: event.target.value })} />
        </div>
      ) : null}

      {hasOptions(type) ? (
        <fieldset className="mt-1 rounded-control border border-divider px-3 pb-2 pt-1">
          <legend className="px-1 text-label font-semibold text-ink">Opciones</legend>
          {errors.options ? (
            <p className="text-caption text-danger" role="alert">
              {errors.options}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {draft.options.map((option, optionIndex) => (
              <li key={option.uid} className="grid items-start gap-x-3 sm:grid-cols-[1fr_1fr_auto]">
                <InputField
                  id={`${id}-opt-${option.uid}-label`}
                  name={`option_label-${index}-${optionIndex}`}
                  label={`Etiqueta de la opción ${optionIndex + 1}`}
                  value={option.label}
                  error={errors[`option:${option.uid}:label`]}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(event) => {
                    const label = event.target.value;
                    // The stored value follows the label until it is edited by hand or already exists.
                    const follows = option.value === "" || option.value === optionValueFromLabel(option.label);
                    onPatch({
                      options: draft.options.map((entry) =>
                        entry.uid === option.uid ? { ...entry, label, value: follows ? optionValueFromLabel(label) : entry.value } : entry,
                      ),
                    });
                  }}
                />
                <InputField
                  id={`${id}-opt-${option.uid}-value`}
                  name={`option_value-${index}-${optionIndex}`}
                  label={`Valor guardado de la opción ${optionIndex + 1}`}
                  value={option.value}
                  error={errors[`option:${option.uid}:value`]}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    onPatch({ options: draft.options.map((entry) => (entry.uid === option.uid ? { ...entry, value: event.target.value } : entry)) })
                  }
                />
                <div className="pt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onPatch({ options: draft.options.filter((entry) => entry.uid !== option.uid) })}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    <span className="sr-only">
                      Quitar la opción {optionIndex + 1} de la pregunta {number}
                    </span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={draft.options.length >= MAX_OPTIONS}
            onClick={() => onPatch({ options: [...draft.options, newOption()] })}
          >
            <Plus className="size-4" aria-hidden="true" />
            Agregar opción
          </Button>
          {type === "MULTISELECT" ? (
            <div className="mt-2 grid gap-x-4 sm:grid-cols-2">
              <InputField id={`${id}-minitems`} name={`min_items-${index}`} label="Mínimo de elecciones" inputMode="numeric" value={draft.min_items} error={errors.min_items} autoComplete="off" onChange={(event) => onPatch({ min_items: event.target.value })} />
              <InputField id={`${id}-maxitems`} name={`max_items-${index}`} label="Máximo de elecciones" inputMode="numeric" value={draft.max_items} error={errors.max_items} autoComplete="off" onChange={(event) => onPatch({ max_items: event.target.value })} />
            </div>
          ) : null}
        </fieldset>
      ) : null}
    </li>
  );
}
