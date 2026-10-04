"use client";

import React from "react";
import { Boxes, Pencil, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { Panel, StatTile } from "@/components/admin/panel";
import { AdminBadge } from "@/components/admin/status-badges";
import { CheckField, InputField, SelectField, TextareaField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import { formatDateTime } from "@/components/admin/format";
import {
  SIZE_PRESETS,
  buildKitDefinitionBody,
  buildKitDefinitionPatch,
  buildVariantBody,
  buildVariantPatch,
  emptyKitDefinition,
  emptyVariant,
  hasFieldErrors,
  inventoryTotals,
  isBelowAllocation,
  isLowStock,
  kitToValues,
  validateKitDefinition,
  validateVariant,
  variantToValues,
  type FieldErrors,
  type KitDefinitionValues,
  type KitRow,
  type KitVariantRow,
  type VariantValues,
} from "@/components/admin/raceday/kit-logic";

/**
 * Kit Center, configuration half (Master §86-88): definitions, sizes (variants) and live inventory by variant. Every write goes through
 * the existing admin APIs (POST /editions/:id/kits, PATCH /kits/:id, POST /kits/:id/variants, PATCH /kits/variants/:id) and the screen
 * shows nothing as saved before the server answers. The counts come from the database inventory read, not from this page.
 */
export function KitCenter({
  editionId,
  timezone,
  kits,
  locked,
}: {
  editionId: string;
  timezone: string;
  kits: readonly KitRow[];
  /** The Edition ended or was canceled: the server refuses these changes, so the buttons are not offered. */
  locked: boolean;
}) {
  const [definition, setDefinition] = React.useState<KitRow | "new" | null>(null);
  const [variant, setVariant] = React.useState<{ kit: KitRow; variant: KitVariantRow | null } | null>(null);
  const totals = inventoryTotals(kits);

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen del inventario">
        <li>
          <StatTile label="Kits asignados" value={totals.allocated} />
        </li>
        <li>
          <StatTile label="Entregados" value={totals.delivered} />
        </li>
        <li>
          <StatTile label="Por entregar" value={totals.pending} />
        </li>
        <li>
          <StatTile label="Con excepción" value={totals.exceptions} hint={totals.exceptions > 0 ? "Revísalos en la lista de participantes" : undefined} />
        </li>
      </ul>

      <Panel
        title="Kits y tallas"
        description="Qué se entrega, en qué tallas y cuánto hay. Las cifras son las de la base de datos."
        actions={
          locked ? undefined : (
            <Button size="sm" onClick={() => setDefinition("new")}>
              <Plus className="size-4" aria-hidden="true" />
              Nuevo kit
            </Button>
          )
        }
      >
        {kits.length === 0 ? (
          <p className="flex items-center gap-2 text-body-sm text-ink-60" data-testid="kits-empty">
            <Boxes className="size-4" aria-hidden="true" />
            Esta edición todavía no tiene kits. Crea uno para poder entregarlo.
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {kits.map((kit) => (
              <li key={kit.kit_definition_id} data-kit-name={kit.name}>
                <KitCard kit={kit} timezone={timezone} locked={locked} onEdit={() => setDefinition(kit)} onVariant={(row) => setVariant({ kit, variant: row })} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {definition ? (
        <DefinitionDialog
          key={definition === "new" ? "new" : definition.kit_definition_id}
          editionId={editionId}
          timezone={timezone}
          kit={definition === "new" ? null : definition}
          onClose={() => setDefinition(null)}
        />
      ) : null}
      {variant ? (
        <VariantDialog
          key={`${variant.kit.kit_definition_id}:${variant.variant?.kit_variant_id ?? "new"}`}
          kit={variant.kit}
          variant={variant.variant}
          onClose={() => setVariant(null)}
        />
      ) : null}
    </div>
  );
}

function KitCard({
  kit,
  timezone,
  locked,
  onEdit,
  onVariant,
}: {
  kit: KitRow;
  timezone: string;
  locked: boolean;
  onEdit: () => void;
  onVariant: (variant: KitVariantRow | null) => void;
}) {
  const window =
    kit.pickup_start_at || kit.pickup_end_at
      ? `Entrega: ${kit.pickup_start_at ? formatDateTime(kit.pickup_start_at, timezone) : "sin apertura"} a ${kit.pickup_end_at ? formatDateTime(kit.pickup_end_at, timezone) : "sin cierre"}`
      : "Sin ventana de entrega definida";
  return (
    <section aria-label={`Kit ${kit.name}`} className="rounded-card border border-divider">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-divider bg-paper-sunken px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-body font-bold text-ink">
            {kit.name}
            <AdminBadge icon={Boxes} tone={kit.status === "ACTIVE" ? "success" : "neutral"}>
              {kit.status === "ACTIVE" ? "Activo" : "Inactivo"}
            </AdminBadge>
          </h3>
          <p className="text-caption text-ink-60">{window}</p>
          {kit.instructions ? <p className="mt-1 whitespace-pre-line text-body-sm text-ink-80">{kit.instructions}</p> : null}
        </div>
        {locked ? null : (
          <div className="flex flex-wrap gap-1">
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              Editar<span className="sr-only"> el kit {kit.name}</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onVariant(null)}>
              <Plus className="size-4" aria-hidden="true" />
              Agregar talla<span className="sr-only"> al kit {kit.name}</span>
            </Button>
          </div>
        )}
      </header>
      {kit.variants.length === 0 ? (
        <p className="px-4 py-3 text-body-sm text-ink-60">Este kit no tiene tallas. Agrega al menos una para poder asignarlo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-body-sm">
            <caption className="sr-only">Inventario del kit {kit.name} por talla</caption>
            <thead>
              <tr className="border-b border-divider text-caption text-ink-60">
                <th scope="col" className="px-4 py-2 font-semibold">Talla</th>
                <th scope="col" className="px-2 py-2 font-semibold">Estado</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Capacidad</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Asignados</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Entregados</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Por entregar</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Excepción</th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">Disponibles</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {kit.variants.map((row) => (
                <tr key={row.kit_variant_id} data-variant-key={row.variant_key}>
                  <th scope="row" className="px-4 py-2 font-semibold text-ink">
                    {row.label}
                    <span className="block text-caption font-normal text-ink-60">{row.variant_key}</span>
                  </th>
                  <td className="px-2 py-2">{row.status === "ACTIVE" ? "Activa" : "Inactiva"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.capacity ?? "Sin límite"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.allocated_count}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.delivered_count}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.pending_count}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.exception_count}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {row.available ?? "—"}
                    {isLowStock(row) ? (
                      <span className="ml-2 inline-flex align-middle">
                        <AdminBadge icon={TriangleAlert} tone="warning">
                          {row.available === 0 ? "Agotada" : "Poco inventario"}
                        </AdminBadge>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {locked ? null : (
                      <Button variant="ghost" size="sm" onClick={() => onVariant(row)}>
                        <Pencil className="size-4" aria-hidden="true" />
                        Editar<span className="sr-only"> la talla {row.label}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- Definition dialog ------------------------------------------------------------------------------------------------------------

function DefinitionDialog({
  editionId,
  timezone,
  kit,
  onClose,
}: {
  editionId: string;
  timezone: string;
  kit: KitRow | null;
  onClose: () => void;
}) {
  const editing = kit !== null;
  const initial = React.useMemo<KitDefinitionValues>(() => (kit ? kitToValues(kit, timezone) : emptyKitDefinition()), [kit, timezone]);
  const [values, setValues] = React.useState(initial);
  const [sizes, setSizes] = React.useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const set = <K extends keyof KitDefinitionValues>(key: K, value: KitDefinitionValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const found = validateKitDefinition(values, timezone);
    setErrors(found);
    if (hasFieldErrors(found)) return null;
    if (kit) {
      const patch = buildKitDefinitionPatch(initial, values, timezone);
      if (!patch) {
        setErrors({ name: "No hay cambios que guardar." });
        return null;
      }
      return apiFetch(`/api/v1/admin/kits/${kit.kit_definition_id}`, { method: "PATCH", body: patch });
    }
    const variants: VariantValues[] = SIZE_PRESETS.filter((size) => sizes.has(size)).map((size) => ({ variant_key: size, label: `Talla ${size}`, capacity: "", status: "ACTIVE" }));
    return apiFetch(`/api/v1/admin/editions/${editionId}/kits`, { method: "POST", body: buildKitDefinitionBody(values, timezone, variants) });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={editing ? `Editar ${kit.name}` : "Nuevo kit"}
      description={`La ventana de entrega se escribe en la hora de la edición (${timezone}).`}
      submitLabel={editing ? "Guardar kit" : "Crear kit"}
      successMessage={editing ? "Kit actualizado" : "Kit creado"}
      onSubmit={onSubmit}
      widthClassName="max-w-2xl"
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <InputField id="kit-name" label="Nombre del kit" required value={values.name} error={errors.name} maxLength={120} autoComplete="off" onChange={(event) => set("name", event.target.value)} className="sm:col-span-2" />
        <SelectField
          id="kit-status"
          label="Estado"
          value={values.status}
          options={[
            { value: "ACTIVE", label: "Activo: se puede entregar" },
            { value: "INACTIVE", label: "Inactivo: no se entrega" },
          ]}
          onChange={(event) => set("status", event.target.value as KitDefinitionValues["status"])}
        />
        <div className="hidden sm:block" />
        <InputField id="kit-start" type="datetime-local" label="Abre la entrega" value={values.pickup_start} error={errors.pickup_start} onChange={(event) => set("pickup_start", event.target.value)} />
        <InputField id="kit-end" type="datetime-local" label="Cierra la entrega" value={values.pickup_end} error={errors.pickup_end} onChange={(event) => set("pickup_end", event.target.value)} />
        <TextareaField id="kit-instructions" label="Instrucciones para la entrega" value={values.instructions} error={errors.instructions} maxLength={2000} className="sm:col-span-2" onChange={(event) => set("instructions", event.target.value)} />
      </div>
      {editing ? null : (
        <fieldset className="mt-1">
          <legend className="text-label font-semibold text-ink">Tallas iniciales (opcional)</legend>
          <div className="mt-1 flex flex-wrap gap-x-4">
            {SIZE_PRESETS.map((size) => (
              <CheckField
                key={size}
                id={`kit-size-${size}`}
                label={size}
                checked={sizes.has(size)}
                onChange={(checked) =>
                  setSizes((current) => {
                    const next = new Set(current);
                    if (checked) next.add(size);
                    else next.delete(size);
                    return next;
                  })
                }
              />
            ))}
          </div>
          <p className="text-caption text-ink-60">Se crean sin límite de cantidad; puedes fijarlo después en cada talla.</p>
        </fieldset>
      )}
    </FormDialog>
  );
}

// ---- Variant dialog ---------------------------------------------------------------------------------------------------------------

function VariantDialog({ kit, variant, onClose }: { kit: KitRow; variant: KitVariantRow | null; onClose: () => void }) {
  const editing = variant !== null;
  const initial = React.useMemo<VariantValues>(() => (variant ? variantToValues(variant) : emptyVariant()), [variant]);
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [acknowledged, setAcknowledged] = React.useState(false);
  const set = <K extends keyof VariantValues>(key: K, value: VariantValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };
  const below = editing && isBelowAllocation(values.capacity, variant.allocated_count);

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const found = validateVariant(values, { editing });
    if (below && !acknowledged) found.capacity = `Ya hay ${variant!.allocated_count} asignados. Confirma abajo que quieres dejar la capacidad por debajo.`;
    setErrors(found);
    if (hasFieldErrors(found)) return null;
    if (variant) {
      const patch = buildVariantPatch(initial, values, below && acknowledged);
      if (!patch) {
        setErrors({ label: "No hay cambios que guardar." });
        return null;
      }
      return apiFetch(`/api/v1/admin/kits/variants/${variant.kit_variant_id}`, { method: "PATCH", body: patch });
    }
    return apiFetch(`/api/v1/admin/kits/${kit.kit_definition_id}/variants`, { method: "POST", body: buildVariantBody(values) });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={editing ? `Editar talla ${variant.label}` : `Agregar talla a ${kit.name}`}
      description={editing ? "Cambiar la capacidad no toca los kits ya asignados." : "La clave identifica la talla y no se puede cambiar después."}
      submitLabel={editing ? "Guardar talla" : "Agregar talla"}
      successMessage={editing ? "Talla actualizada" : "Talla agregada"}
      onSubmit={onSubmit}
    >
      <InputField
        id="variant-key"
        label="Clave"
        required={!editing}
        disabled={editing}
        value={values.variant_key}
        error={errors.variant_key}
        maxLength={32}
        autoComplete="off"
        helperText="Por ejemplo M, XL o NINO-8."
        onChange={(event) => set("variant_key", event.target.value)}
      />
      <InputField id="variant-label" label="Nombre visible" required value={values.label} error={errors.label} maxLength={80} autoComplete="off" onChange={(event) => set("label", event.target.value)} />
      <InputField
        id="variant-capacity"
        label="Capacidad"
        inputMode="numeric"
        value={values.capacity}
        error={errors.capacity}
        helperText="Vacío = sin límite."
        onChange={(event) => set("capacity", event.target.value)}
      />
      {below ? (
        <CheckField id="variant-ack" label={`Entiendo que ya hay ${variant!.allocated_count} asignados y no se quitan`} checked={acknowledged} onChange={setAcknowledged} />
      ) : null}
      <SelectField
        id="variant-status"
        label="Estado"
        value={values.status}
        options={[
          { value: "ACTIVE", label: "Activa: se puede asignar" },
          { value: "INACTIVE", label: "Inactiva: no se asigna" },
        ]}
        onChange={(event) => set("status", event.target.value as VariantValues["status"])}
      />
    </FormDialog>
  );
}
