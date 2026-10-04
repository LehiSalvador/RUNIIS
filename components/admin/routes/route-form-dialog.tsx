"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ApiResult } from "@/lib/client/api";
import { CheckField, InputField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import { createRoute, duplicateRoute } from "@/components/admin/routes/route-api";
import { formatKm, type ModalityOption, type RouteRow } from "@/components/admin/routes/route-geometry";

const MODALITY_STATUS_NOTE: Record<string, string> = { CLOSED: " (cerrada)", CANCELED: " (cancelada)" };

/**
 * Create a Route for the Edition, or duplicate one (Master §48: CreateRoute -> pick modalities -> MANUAL, GPX or DUPLICATE). A Route
 * belongs to ONE Edition and serves one or more of its modalities; the server verifies that every modality belongs to the Edition.
 * Duplicating copies the active (or latest) revision into a new Route with a new DRAFT revision.
 */
export function RouteFormDialog({
  mode,
  editionId,
  source,
  modalities,
  onClose,
}: {
  mode: "create" | "duplicate";
  editionId: string;
  source?: RouteRow;
  modalities: readonly ModalityOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = React.useState(mode === "duplicate" && source ? `Copia de ${source.name}`.slice(0, 160) : "");
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set(mode === "duplicate" && source ? source.modality_ids : []));
  const [errors, setErrors] = React.useState<{ name?: string; modalities?: string }>({});

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setErrors((current) => ({ ...current, modalities: undefined }));
  };

  async function onSubmit({ idempotencyKey }: { idempotencyKey: string }): Promise<ApiResult<unknown> | null> {
    const next: { name?: string; modalities?: string } = {};
    const trimmed = name.trim();
    if (!trimmed) next.name = "Este campo es obligatorio.";
    else if (trimmed.length > 160) next.name = "Máximo 160 caracteres.";
    if (selected.size === 0) next.modalities = "Elige al menos una modalidad que use esta ruta.";
    if (selected.size > 20) next.modalities = "Una ruta admite como máximo 20 modalidades.";
    setErrors(next);
    if (next.name || next.modalities) return null;

    const body = { name: trimmed, modality_ids: modalities.filter((modality) => selected.has(modality.modality_id)).map((modality) => modality.modality_id) };
    const result = mode === "duplicate" && source ? await duplicateRoute(source.route_id, body, idempotencyKey) : await createRoute(editionId, body, idempotencyKey);
    // Navigate to the new Route only after the server created it.
    if (result.ok) router.push(`${pathname}?route=${result.data.route_id}`);
    return result;
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={mode === "duplicate" ? `Duplicar «${source?.name ?? "ruta"}»` : "Nueva ruta"}
      description={
        mode === "duplicate"
          ? "Se crea una ruta nueva con el recorrido y los puntos de la revisión vigente (o la más reciente), como borrador."
          : "Después podrás importar un GPX o dibujar el recorrido, validarlo y publicarlo."
      }
      submitLabel={mode === "duplicate" ? "Duplicar ruta" : "Crear ruta"}
      successMessage={mode === "duplicate" ? "Ruta duplicada" : "Ruta creada"}
      onSubmit={onSubmit}
    >
      <InputField
        id="route-name"
        name="name"
        label="Nombre de la ruta"
        required
        value={name}
        error={errors.name}
        maxLength={160}
        autoComplete="off"
        helperText="Es el nombre que verá el público junto al mapa."
        onChange={(event) => {
          setName(event.target.value);
          setErrors((current) => ({ ...current, name: undefined }));
        }}
      />
      <fieldset className="mt-1" aria-describedby={errors.modalities ? "route-modalities-error" : undefined}>
        <legend className="text-label font-semibold text-ink">
          Modalidades que recorren esta ruta<span aria-hidden="true" className="text-danger"> *</span>
        </legend>
        {modalities.length === 0 ? (
          <p className="text-body-sm text-ink-60">La edición todavía no tiene modalidades. Crea al menos una en «Modalidades y precios».</p>
        ) : (
          <div className="mt-1 flex flex-col">
            {modalities.map((modality) => (
              <CheckField
                key={modality.modality_id}
                id={`route-modality-${modality.modality_id}`}
                label={`${modality.name}${MODALITY_STATUS_NOTE[modality.status] ?? ""}`}
                helperText={modality.official_distance_m ? `Distancia oficial ${formatKm(modality.official_distance_m, 1)}` : "Sin distancia oficial"}
                checked={selected.has(modality.modality_id)}
                onChange={(checked) => toggle(modality.modality_id, checked)}
              />
            ))}
          </div>
        )}
        {errors.modalities ? (
          <p id="route-modalities-error" role="alert" className="mt-1 text-caption text-danger">
            {errors.modalities}
          </p>
        ) : null}
      </fieldset>
    </FormDialog>
  );
}
