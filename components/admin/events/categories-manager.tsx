"use client";

import React from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { Panel } from "@/components/admin/panel";
import { CheckField, InputField, SelectField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import { EligibilityFields } from "@/components/admin/events/modalities-manager";
import {
  buildEligibility,
  describeEligibility,
  eligibilityToForm,
  isValidKey,
  keyify,
  validateEligibility,
  type EligibilityForm,
  type EligibilityRules,
  type FieldErrors,
} from "@/components/admin/events/form-logic";

export type CategoryRow = {
  category_id: string;
  key: string;
  name: string;
  assignment_mode: "USER_SELECTS" | "SYSTEM_DERIVES";
  eligibility_rule: EligibilityRules;
  active: boolean;
  sort_order: number;
  modality_ids: string[];
};

const MODE_LABEL = { USER_SELECTS: "La persona la elige", SYSTEM_DERIVES: "El sistema la deriva (edad/sexo)" } as const;

export function CategoriesManager({
  editionId,
  categories,
  modalities,
}: {
  editionId: string;
  categories: readonly CategoryRow[];
  modalities: readonly { modality_id: string; name: string }[];
}) {
  const [editing, setEditing] = React.useState<CategoryRow | "new" | null>(null);
  const names = new Map(modalities.map((modality) => [modality.modality_id, modality.name]));

  return (
    <Panel
      title="Categorías"
      description="Agrupan a los participantes dentro de las modalidades (por ejemplo, por edad). Son opcionales."
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" />
          Agregar categoría
        </Button>
      }
    >
      {categories.length === 0 ? (
        <p className="text-body-sm text-ink-60" data-testid="categories-empty">
          Sin categorías todavía.
        </p>
      ) : (
        <ul className="divide-y divide-divider">
          {categories.map((category) => (
            <li key={category.category_id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0" data-category-key={category.key}>
              <div className="min-w-0">
                <p className="text-body-sm font-semibold text-ink">
                  {category.name} <span className="font-mono text-caption font-normal text-ink-60">{category.key}</span>
                  {category.active ? null : <span className="ml-2 text-caption font-normal text-ink-60">(inactiva)</span>}
                </p>
                <p className="text-caption text-ink-60">
                  {MODE_LABEL[category.assignment_mode]} · {describeEligibility(category.eligibility_rule)}
                </p>
                <p className="text-caption text-ink-60">
                  Modalidades:{" "}
                  {category.modality_ids.length === 0 ? "ninguna" : category.modality_ids.map((id) => names.get(id) ?? "Modalidad").join(", ")}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(category)}>
                <Pencil className="size-4" aria-hidden="true" />
                Editar<span className="sr-only"> categoría {category.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <CategoryDialog
          key={editing === "new" ? "new" : editing.category_id}
          editionId={editionId}
          category={editing === "new" ? null : editing}
          modalities={modalities}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Panel>
  );
}

type CategoryValues = {
  key: string;
  name: string;
  assignment_mode: "USER_SELECTS" | "SYSTEM_DERIVES";
  active: boolean;
  sort_order: string;
  modality_ids: string[];
  eligibility: EligibilityForm;
};

function CategoryDialog({
  editionId,
  category,
  modalities,
  onClose,
}: {
  editionId: string;
  category: CategoryRow | null;
  modalities: readonly { modality_id: string; name: string }[];
  onClose: () => void;
}) {
  const editing = category !== null;
  const initial: CategoryValues = category
    ? {
        key: category.key,
        name: category.name,
        assignment_mode: category.assignment_mode,
        active: category.active,
        sort_order: String(category.sort_order),
        modality_ids: [...category.modality_ids],
        eligibility: eligibilityToForm(category.eligibility_rule),
      }
    : { key: "", name: "", assignment_mode: "USER_SELECTS", active: true, sort_order: "", modality_ids: [], eligibility: { min_age: "", max_age: "", sex_codes: [] } };
  const [values, setValues] = React.useState(initial);
  const [keyTouched, setKeyTouched] = React.useState(editing);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const body = (state: CategoryValues) => ({
    key: state.key,
    name: state.name.trim(),
    assignment_mode: state.assignment_mode,
    active: state.active,
    eligibility_rule: buildEligibility(state.eligibility),
    modality_ids: state.modality_ids,
    ...(state.sort_order.trim() !== "" ? { sort_order: Number(state.sort_order) } : {}),
  });

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const next: FieldErrors = { ...validateEligibility(values.eligibility) };
    if (!values.name.trim()) next.name = "Este campo es obligatorio.";
    if (!values.key) next.key = "Este campo es obligatorio.";
    else if (!isValidKey(values.key)) next.key = "Minúsculas y números, separados por guion o guion bajo.";
    if (values.sort_order.trim() !== "" && !/^\d{1,5}$/.test(values.sort_order.trim())) next.sort_order = "Número entero, 0 o mayor.";
    setErrors(next);
    if (Object.values(next).some(Boolean)) return null;

    const payload: Record<string, unknown> = body(values);
    if (category) {
      const before: Record<string, unknown> = body(initial);
      for (const field of Object.keys(payload)) if (JSON.stringify(payload[field]) === JSON.stringify(before[field])) delete payload[field];
      if (Object.keys(payload).length === 0) {
        setErrors({ name: "No hay cambios que guardar." });
        return null;
      }
      return apiFetch(`/api/v1/admin/categories/${category.category_id}`, { method: "PATCH", body: payload });
    }
    return apiFetch(`/api/v1/admin/editions/${editionId}/categories`, { method: "POST", body: payload });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={editing ? `Editar ${category.name}` : "Agregar categoría"}
      submitLabel={editing ? "Guardar categoría" : "Agregar categoría"}
      successMessage={editing ? "Categoría actualizada" : "Categoría agregada"}
      onSubmit={onSubmit}
      widthClassName="max-w-2xl"
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <InputField
          id="category-name"
          name="name"
          label="Nombre"
          required
          value={values.name}
          error={errors.name}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => {
            const name = event.target.value;
            setValues((current) => ({ ...current, name, key: keyTouched ? current.key : keyify(name) }));
          }}
        />
        <InputField
          id="category-key"
          name="key"
          label="Clave"
          required
          value={values.key}
          error={errors.key}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setKeyTouched(true);
            setValues((current) => ({ ...current, key: event.target.value }));
          }}
        />
        <SelectField
          id="category-mode"
          name="assignment_mode"
          label="Asignación"
          value={values.assignment_mode}
          options={[
            { value: "USER_SELECTS", label: MODE_LABEL.USER_SELECTS },
            { value: "SYSTEM_DERIVES", label: MODE_LABEL.SYSTEM_DERIVES },
          ]}
          onChange={(event) => setValues((current) => ({ ...current, assignment_mode: event.target.value === "SYSTEM_DERIVES" ? "SYSTEM_DERIVES" : "USER_SELECTS" }))}
        />
        <InputField
          id="category-order"
          name="sort_order"
          label="Orden"
          inputMode="numeric"
          value={values.sort_order}
          error={errors.sort_order}
          autoComplete="off"
          onChange={(event) => setValues((current) => ({ ...current, sort_order: event.target.value }))}
        />
      </div>
      <CheckField id="category-active" label="Categoría activa" checked={values.active} onChange={(active) => setValues((current) => ({ ...current, active }))} />
      <fieldset className="rounded-control border border-divider px-3 pb-1 pt-2">
        <legend className="px-1 text-label font-semibold text-ink">Modalidades donde aplica</legend>
        {modalities.length === 0 ? (
          <p className="pb-2 text-body-sm text-ink-60">Agrega modalidades primero.</p>
        ) : (
          <div className="flex flex-wrap gap-x-5">
            {modalities.map((modality) => (
              <CheckField
                key={modality.modality_id}
                id={`category-modality-${modality.modality_id}`}
                label={modality.name}
                checked={values.modality_ids.includes(modality.modality_id)}
                onChange={(checked) =>
                  setValues((current) => ({
                    ...current,
                    modality_ids: checked ? [...current.modality_ids, modality.modality_id] : current.modality_ids.filter((id) => id !== modality.modality_id),
                  }))
                }
              />
            ))}
          </div>
        )}
      </fieldset>
      <EligibilityFields idPrefix="category" value={values.eligibility} errors={errors} onChange={(eligibility) => setValues((current) => ({ ...current, eligibility }))} />
    </FormDialog>
  );
}
