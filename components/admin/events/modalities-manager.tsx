"use client";

import React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Panel } from "@/components/admin/panel";
import { capacityStateLabel, parseAvailability, type CapacityView } from "@/components/admin/capacity";
import { AdminBadge } from "@/components/admin/status-badges";
import { formatClock, formatDateTime } from "@/components/admin/format";
import { CheckField, InputField, TextareaField } from "@/components/admin/events/fields";
import { FormDialog } from "@/components/admin/events/form-dialog";
import {
  SEX_OPTIONS,
  buildModalityBody,
  buildPriceBody,
  describeEligibility,
  describeRefusal,
  eligibilityToForm,
  emptyModalityValues,
  formatDistance,
  formatMoney,
  isoToZonedLocal,
  keyify,
  metersToKmInput,
  minorToInput,
  parseOptionalCount,
  validateModalityValues,
  validatePriceValues,
  toTimeInput,
  type EligibilityForm,
  type EligibilityRules,
  type FieldErrors,
  type ModalityFormValues,
  type PriceFormValues,
} from "@/components/admin/events/form-logic";
import { CircleCheck, CircleDashed, XCircle } from "lucide-react";

export type PriceRow = {
  price_offer_id: string;
  name: string;
  amount_minor: number;
  currency: string;
  starts_at: string | null;
  ends_at: string | null;
  status: "ACTIVE" | "INACTIVE" | "EXPIRED";
};

export type ModalityRow = {
  modality_id: string;
  key: string;
  name: string;
  official_distance_m: number | null;
  generates_distance_credit: boolean;
  local_start_time: string | null;
  status: "ACTIVE" | "CLOSED" | "CANCELED";
  sort_order: number;
  eligibility_rules: EligibilityRules;
  effective_capacity: number | null;
  category_ids: string[];
  price_offers: PriceRow[];
};

const MODALITY_STATUS = {
  ACTIVE: { label: "Activa", icon: CircleCheck, tone: "success" },
  CLOSED: { label: "Cerrada", icon: CircleDashed, tone: "warning" },
  CANCELED: { label: "Cancelada", icon: XCircle, tone: "danger" },
} as const;

const PRICE_STATUS: Record<string, string> = { ACTIVE: "Activo", INACTIVE: "Inactivo", EXPIRED: "Vencido" };

type Dialog =
  | { kind: "modality"; modality: ModalityRow | null }
  | { kind: "capacity"; scope: "global" }
  | { kind: "capacity"; scope: "modality"; modality: ModalityRow }
  | { kind: "price"; modality: ModalityRow; price: PriceRow | null }
  | { kind: "status"; modality: ModalityRow; next: "ACTIVE" | "CLOSED" | "CANCELED" }
  | { kind: "delete"; modality: ModalityRow };

export function ModalitiesManager({
  editionId,
  timezone,
  publicationState,
  globalCapacity,
  availability,
  modalities,
}: {
  editionId: string;
  timezone: string;
  publicationState: string;
  globalCapacity: number | null;
  availability: unknown;
  modalities: readonly ModalityRow[];
}) {
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const view = parseAvailability(availability);
  const live = new Map(view?.modalities.map((entry) => [entry.modality_id, entry]) ?? []);
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Capacidad total de la edición"
        description="Lo configurado y lo ocupado vienen del servidor. Los lugares libres se calculan; no se editan."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: "capacity", scope: "global" })}>
            <Pencil className="size-4" aria-hidden="true" />
            Cambiar capacidad total
          </Button>
        }
      >
        <LiveCounts
          capacity={view?.global.capacity ?? globalCapacity}
          confirmed={view?.global.confirmed}
          holds={view?.global.active_holds}
          available={view?.global.available}
          stateLabel={view ? capacityStateLabel(view.global.state) : null}
        />
      </Panel>

      <Panel
        title="Modalidades y precios"
        description={`Horas en la zona de la edición (${timezone}). Precios en pesos (MXN); el modelo V1 no cobra en línea.`}
        actions={
          <Button size="sm" onClick={() => setDialog({ kind: "modality", modality: null })}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar modalidad
          </Button>
        }
      >
        {modalities.length === 0 ? (
          <p className="text-body-sm text-ink-60" data-testid="modalities-empty">
            Esta edición todavía no tiene modalidades. Agrega al menos una para poder publicarla.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {modalities.map((modality) => (
              <ModalityCard
                key={modality.modality_id}
                modality={modality}
                live={live.get(modality.modality_id)}
                timezone={timezone}
                draft={publicationState === "DRAFT"}
                onAction={setDialog}
              />
            ))}
          </ul>
        )}
      </Panel>

      {dialog?.kind === "modality" ? (
        <ModalityDialog key={dialog.modality?.modality_id ?? "new"} editionId={editionId} modality={dialog.modality} onClose={close} />
      ) : null}
      {dialog?.kind === "capacity" ? (
        <CapacityDialog
          key={dialog.scope === "global" ? "global" : dialog.modality.modality_id}
          editionId={editionId}
          target={dialog.scope === "global" ? { scope: "global", current: globalCapacity } : { scope: "modality", modality: dialog.modality }}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "price" ? (
        <PriceDialog key={dialog.price?.price_offer_id ?? `new-${dialog.modality.modality_id}`} modality={dialog.modality} price={dialog.price} timezone={timezone} onClose={close} />
      ) : null}
      {dialog?.kind === "status" ? <StatusDialog key={`${dialog.modality.modality_id}-${dialog.next}`} modality={dialog.modality} next={dialog.next} onClose={close} /> : null}
      {dialog?.kind === "delete" ? <DeleteDialog modality={dialog.modality} onClose={close} /> : null}
    </div>
  );
}

function LiveCounts({
  capacity,
  confirmed,
  holds,
  available,
  stateLabel,
}: {
  capacity: number | null;
  confirmed?: number;
  holds?: number;
  available?: number | null;
  stateLabel: string | null;
}) {
  return (
    <p className="text-body-sm tabular-nums text-ink-80" data-testid="live-counts">
      Capacidad configurada: <strong className="text-ink">{capacity ?? "sin límite"}</strong>
      {confirmed === undefined ? (
        " · Ocupación no disponible por ahora."
      ) : (
        <>
          {" · "}Confirmados {confirmed} · Apartados {holds ?? 0} · Libres {available ?? "—"}
          {stateLabel ? ` · ${stateLabel}` : ""}
        </>
      )}
    </p>
  );
}

function ModalityCard({
  modality,
  live,
  timezone,
  draft,
  onAction,
}: {
  modality: ModalityRow;
  live: CapacityView["modalities"][number] | undefined;
  timezone: string;
  draft: boolean;
  onAction: (dialog: Dialog) => void;
}) {
  const status = MODALITY_STATUS[modality.status];
  const terminal = modality.status === "CANCELED";
  const headingId = `modality-${modality.modality_id}`;
  return (
    <li>
      <article aria-labelledby={headingId} className="rounded-control border border-divider" data-modality-key={modality.key}>
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-divider px-3 py-2">
          <div className="min-w-0">
            <h3 id={headingId} className="text-body font-bold text-ink">
              {modality.name} <span className="font-mono text-caption font-normal text-ink-60">{modality.key}</span>
            </h3>
            <p className="text-caption text-ink-60">
              {formatDistance(modality.official_distance_m)}
              {modality.local_start_time ? ` · Sale a las ${formatClock(modality.local_start_time)}` : ""}
              {modality.generates_distance_credit ? " · Acredita distancia" : ""}
            </p>
            <p className="text-caption text-ink-60">Elegibilidad: {describeEligibility(modality.eligibility_rules)}</p>
          </div>
          <AdminBadge icon={status.icon} tone={status.tone}>
            {status.label}
          </AdminBadge>
        </header>

        <div className="flex flex-col gap-3 p-3">
          <LiveCounts
            capacity={live?.effective_capacity ?? modality.effective_capacity}
            confirmed={live?.confirmed}
            holds={live?.active_holds}
            available={live?.available}
            stateLabel={live ? capacityStateLabel(live.state) : null}
          />

          <div>
            <p className="text-label font-semibold text-ink">Precios</p>
            {modality.price_offers.length === 0 ? (
              <p className="text-body-sm text-ink-60">Sin precios. Agrega uno (0 = gratuita) para poder abrir inscripciones.</p>
            ) : (
              <ul className="mt-1 divide-y divide-divider">
                {modality.price_offers.map((price) => (
                  <li key={price.price_offer_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="text-body-sm text-ink">
                      <strong className="tabular-nums">{formatMoney(price.amount_minor, price.currency)}</strong> · {price.name}
                      <span className="block text-caption text-ink-60">
                        {PRICE_STATUS[price.status] ?? price.status}
                        {price.starts_at ? ` · desde ${formatDateTime(price.starts_at, timezone)}` : ""}
                        {price.ends_at ? ` · hasta ${formatDateTime(price.ends_at, timezone)}` : ""}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" disabled={terminal} onClick={() => onAction({ kind: "price", modality, price })}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Editar<span className="sr-only"> precio {price.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={terminal} onClick={() => onAction({ kind: "modality", modality })}>
              Editar<span className="sr-only"> modalidad {modality.name}</span>
            </Button>
            <Button variant="secondary" size="sm" disabled={terminal} onClick={() => onAction({ kind: "price", modality, price: null })}>
              Agregar precio<span className="sr-only"> a {modality.name}</span>
            </Button>
            <Button variant="secondary" size="sm" disabled={terminal} onClick={() => onAction({ kind: "capacity", scope: "modality", modality })}>
              Capacidad<span className="sr-only"> de {modality.name}</span>
            </Button>
            {modality.status === "ACTIVE" ? (
              <Button variant="secondary" size="sm" onClick={() => onAction({ kind: "status", modality, next: "CLOSED" })}>
                Cerrar<span className="sr-only"> modalidad {modality.name}</span>
              </Button>
            ) : null}
            {modality.status === "CLOSED" ? (
              <Button variant="secondary" size="sm" onClick={() => onAction({ kind: "status", modality, next: "ACTIVE" })}>
                Reactivar<span className="sr-only"> modalidad {modality.name}</span>
              </Button>
            ) : null}
            {!terminal ? (
              <Button variant="secondary" size="sm" onClick={() => onAction({ kind: "status", modality, next: "CANCELED" })}>
                Cancelar<span className="sr-only"> modalidad {modality.name}</span>
              </Button>
            ) : null}
            {draft ? (
              <Button variant="ghost" size="sm" onClick={() => onAction({ kind: "delete", modality })}>
                <Trash2 className="size-4" aria-hidden="true" />
                Eliminar<span className="sr-only"> modalidad {modality.name}</span>
              </Button>
            ) : null}
          </div>
        </div>
      </article>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Eligibility fields (shared with categories)
// ---------------------------------------------------------------------------------------------

export function EligibilityFields({
  idPrefix,
  value,
  errors,
  onChange,
}: {
  idPrefix: string;
  value: EligibilityForm;
  errors: FieldErrors;
  onChange: (next: EligibilityForm) => void;
}) {
  return (
    <fieldset className="rounded-control border border-divider px-3 pb-1 pt-2">
      <legend className="px-1 text-label font-semibold text-ink">Elegibilidad (opcional)</legend>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <InputField
          id={`${idPrefix}-min-age`}
          name="min_age"
          label="Edad mínima"
          inputMode="numeric"
          value={value.min_age}
          error={errors.min_age}
          onChange={(event) => onChange({ ...value, min_age: event.target.value })}
        />
        <InputField
          id={`${idPrefix}-max-age`}
          name="max_age"
          label="Edad máxima"
          inputMode="numeric"
          value={value.max_age}
          error={errors.max_age}
          onChange={(event) => onChange({ ...value, max_age: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-x-5">
        {SEX_OPTIONS.map((option) => (
          <CheckField
            key={option.value}
            id={`${idPrefix}-sex-${option.value}`}
            label={option.label}
            checked={value.sex_codes.includes(option.value)}
            onChange={(checked) =>
              onChange({ ...value, sex_codes: checked ? [...value.sex_codes, option.value] : value.sex_codes.filter((code) => code !== option.value) })
            }
          />
        ))}
      </div>
      <p className="pb-2 text-caption text-ink-60">Sin criterios marcados: sin restricciones.</p>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------------------------

function ModalityDialog({ editionId, modality, onClose }: { editionId: string; modality: ModalityRow | null; onClose: () => void }) {
  const editing = modality !== null;
  const initial: ModalityFormValues = modality
    ? {
        key: modality.key,
        name: modality.name,
        distance_km: metersToKmInput(modality.official_distance_m),
        generates_distance_credit: modality.generates_distance_credit,
        local_start_time: toTimeInput(modality.local_start_time),
        sort_order: String(modality.sort_order),
        effective_capacity: "",
        eligibility: eligibilityToForm(modality.eligibility_rules),
      }
    : emptyModalityValues();
  const [values, setValues] = React.useState(initial);
  const [keyTouched, setKeyTouched] = React.useState(editing);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  async function onSubmit({ idempotencyKey }: { idempotencyKey: string }): Promise<ApiResult<unknown> | null> {
    const next = validateModalityValues(values, editing ? "edit" : "create");
    setErrors(next);
    if (Object.values(next).some(Boolean)) return null;
    const body = buildModalityBody(values, editing ? "edit" : "create");
    if (modality) {
      // Only what changed travels (a changed key is refused by the server once the modality has requests).
      const before = buildModalityBody(initial, "edit");
      for (const field of Object.keys(body)) if (JSON.stringify(body[field]) === JSON.stringify(before[field])) delete body[field];
      if (Object.keys(body).length === 0) {
        setErrors({ name: "No hay cambios que guardar." });
        return null;
      }
      return apiFetch(`/api/v1/admin/modalities/${modality.modality_id}`, { method: "PATCH", body });
    }
    return apiFetch(`/api/v1/admin/editions/${editionId}/modalities`, { method: "POST", body, idempotencyKey });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={editing ? `Editar ${modality.name}` : "Agregar modalidad"}
      description="Una modalidad es una distancia o categoría de participación (por ejemplo 5K o 10K)."
      submitLabel={editing ? "Guardar modalidad" : "Agregar modalidad"}
      successMessage={editing ? "Modalidad actualizada" : "Modalidad agregada"}
      onSubmit={onSubmit}
      widthClassName="max-w-2xl"
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <InputField
          id="modality-name"
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
          id="modality-key"
          name="key"
          label="Clave"
          required
          value={values.key}
          error={errors.key}
          helperText="Identificador corto (ej. 10k)."
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setKeyTouched(true);
            setValues((current) => ({ ...current, key: event.target.value }));
          }}
        />
        <InputField
          id="modality-distance"
          name="distance_km"
          label="Distancia oficial (km)"
          inputMode="decimal"
          value={values.distance_km}
          error={errors.distance_km}
          helperText="Obligatoria si la modalidad acredita distancia."
          autoComplete="off"
          onChange={(event) => setValues((current) => ({ ...current, distance_km: event.target.value }))}
        />
        <InputField
          id="modality-start"
          name="local_start_time"
          type="time"
          label="Hora de salida"
          value={values.local_start_time}
          onChange={(event) => setValues((current) => ({ ...current, local_start_time: event.target.value }))}
        />
        <InputField
          id="modality-order"
          name="sort_order"
          label="Orden"
          inputMode="numeric"
          value={values.sort_order}
          error={errors.sort_order}
          helperText="Vacío: al final."
          autoComplete="off"
          onChange={(event) => setValues((current) => ({ ...current, sort_order: event.target.value }))}
        />
        {!editing ? (
          <InputField
            id="modality-capacity"
            name="effective_capacity"
            label="Capacidad"
            inputMode="numeric"
            value={values.effective_capacity}
            error={errors.effective_capacity}
            helperText="Vacía: sin límite. Se puede cambiar después."
            autoComplete="off"
            onChange={(event) => setValues((current) => ({ ...current, effective_capacity: event.target.value }))}
          />
        ) : null}
      </div>
      <CheckField
        id="modality-credit"
        label="Acredita distancia al participante"
        checked={values.generates_distance_credit}
        onChange={(checked) => setValues((current) => ({ ...current, generates_distance_credit: checked }))}
      />
      <EligibilityFields idPrefix="modality" value={values.eligibility} errors={errors} onChange={(eligibility) => setValues((current) => ({ ...current, eligibility }))} />
    </FormDialog>
  );
}

function CapacityDialog({
  editionId,
  target,
  onClose,
}: {
  editionId: string;
  target: { scope: "global"; current: number | null } | { scope: "modality"; modality: ModalityRow };
  onClose: () => void;
}) {
  const current = target.scope === "global" ? target.current : target.modality.effective_capacity;
  const [value, setValue] = React.useState(current === null ? "" : String(current));
  const [error, setError] = React.useState<string | undefined>();
  const [acknowledge, setAcknowledge] = React.useState(false);
  const [needsAck, setNeedsAck] = React.useState<{ confirmed: number; activeHolds: number } | null>(null);
  const label = target.scope === "global" ? "Capacidad total de la edición" : `Capacidad de ${target.modality.name}`;

  async function onSubmit(): Promise<ApiResult<unknown> | null> {
    const parsed = parseOptionalCount(value);
    if (parsed === undefined) {
      setError("Número entero, 0 o mayor (vacío = sin límite).");
      return null;
    }
    setError(undefined);
    const path = target.scope === "global" ? `/api/v1/admin/editions/${editionId}/capacity` : `/api/v1/admin/modalities/${target.modality.modality_id}/capacity`;
    const body = target.scope === "global" ? { global_capacity: parsed } : { effective_capacity: parsed };
    const result = await apiFetch(path, { method: "POST", body: { ...body, ...(acknowledge ? { acknowledge_below_occupation: true } : {}) } });
    if (!result.ok) setNeedsAck(describeRefusal(result).needsCapacityAcknowledgement);
    return result;
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={label}
      description="Cambiar la capacidad nunca toca los registros ni los apartados existentes. Los lugares libres se calculan."
      submitLabel="Guardar capacidad"
      successMessage="Capacidad actualizada"
      onSubmit={onSubmit}
    >
      <InputField
        id="capacity-value"
        name="capacity"
        label={label}
        inputMode="numeric"
        value={value}
        error={error}
        helperText="Vacío: sin límite."
        autoComplete="off"
        onChange={(event) => {
          setValue(event.target.value);
          setAcknowledge(false);
        }}
      />
      {needsAck ? (
        <CheckField
          id="capacity-ack"
          label={`Entiendo que la capacidad queda por debajo de los ${needsAck.confirmed + needsAck.activeHolds} lugares ocupados y quiero aplicarla`}
          checked={acknowledge}
          onChange={setAcknowledge}
          helperText="Marca la casilla y vuelve a guardar."
        />
      ) : null}
    </FormDialog>
  );
}

function PriceDialog({ modality, price, timezone, onClose }: { modality: ModalityRow; price: PriceRow | null; timezone: string; onClose: () => void }) {
  const editing = price !== null;
  const initial: PriceFormValues = price
    ? {
        name: price.name,
        amount: minorToInput(price.amount_minor),
        starts_at: isoToZonedLocal(price.starts_at, timezone),
        ends_at: isoToZonedLocal(price.ends_at, timezone),
        status: price.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      }
    : { name: "Precio general", amount: "", starts_at: "", ends_at: "", status: "ACTIVE" };
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  async function onSubmit({ idempotencyKey }: { idempotencyKey: string }): Promise<ApiResult<unknown> | null> {
    const next = validatePriceValues(values, timezone);
    setErrors(next);
    if (Object.values(next).some(Boolean)) return null;
    const body = buildPriceBody(values, timezone, editing ? "edit" : "create");
    if (price) {
      const before = buildPriceBody(initial, timezone, "edit");
      for (const field of Object.keys(body)) if (JSON.stringify(body[field]) === JSON.stringify(before[field])) delete body[field];
      if (Object.keys(body).length === 0) {
        setErrors({ name: "No hay cambios que guardar." });
        return null;
      }
      return apiFetch(`/api/v1/admin/prices/${price.price_offer_id}`, { method: "PATCH", body });
    }
    return apiFetch(`/api/v1/admin/modalities/${modality.modality_id}/prices`, { method: "POST", body, idempotencyKey });
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={editing ? `Editar precio de ${modality.name}` : `Agregar precio a ${modality.name}`}
      description="Modelo V1: el precio es informativo (gratuita o pago por WhatsApp); no hay cobro en línea. Un monto de 0 significa gratuita."
      submitLabel={editing ? "Guardar precio" : "Agregar precio"}
      successMessage={editing ? "Precio actualizado" : "Precio agregado"}
      onSubmit={onSubmit}
      widthClassName="max-w-2xl"
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <InputField
          id="price-name"
          name="name"
          label="Nombre del precio"
          required
          value={values.name}
          error={errors.name}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
        />
        <InputField
          id="price-amount"
          name="amount"
          label="Monto (MXN)"
          required
          inputMode="decimal"
          value={values.amount}
          error={errors.amount}
          helperText="Ej. 350 o 350.00. 0 = gratuita."
          autoComplete="off"
          onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))}
        />
        <InputField
          id="price-starts"
          name="starts_at"
          type="datetime-local"
          label="Vigente desde"
          value={values.starts_at}
          error={errors.starts_at}
          helperText={`Opcional, hora de ${timezone}.`}
          onChange={(event) => setValues((current) => ({ ...current, starts_at: event.target.value }))}
        />
        <InputField
          id="price-ends"
          name="ends_at"
          type="datetime-local"
          label="Vigente hasta"
          value={values.ends_at}
          error={errors.ends_at}
          helperText={`Opcional, hora de ${timezone}.`}
          onChange={(event) => setValues((current) => ({ ...current, ends_at: event.target.value }))}
        />
      </div>
      <CheckField
        id="price-active"
        label="Precio activo"
        checked={values.status === "ACTIVE"}
        onChange={(checked) => setValues((current) => ({ ...current, status: checked ? "ACTIVE" : "INACTIVE" }))}
      />
    </FormDialog>
  );
}

const STATUS_COPY = {
  CLOSED: {
    title: "Cerrar modalidad",
    description: "Deja de aceptar solicitudes nuevas. Las inscripciones existentes no se tocan y puedes reactivarla.",
    submit: "Cerrar modalidad",
    success: "Modalidad cerrada",
    tone: "primary",
  },
  ACTIVE: {
    title: "Reactivar modalidad",
    description: "Vuelve a aceptar solicitudes nuevas.",
    submit: "Reactivar",
    success: "Modalidad reactivada",
    tone: "primary",
  },
  CANCELED: {
    title: "Cancelar modalidad",
    description: "La modalidad se cancela de forma definitiva (no se puede reactivar). Las inscripciones existentes no se tocan.",
    submit: "Cancelar modalidad",
    success: "Modalidad cancelada",
    tone: "danger",
  },
} as const;

function StatusDialog({ modality, next, onClose }: { modality: ModalityRow; next: "ACTIVE" | "CLOSED" | "CANCELED"; onClose: () => void }) {
  const copy = STATUS_COPY[next];
  const [reason, setReason] = React.useState("");
  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${copy.title}: ${modality.name}`}
      description={copy.description}
      submitLabel={copy.submit}
      successMessage={copy.success}
      tone={copy.tone}
      onSubmit={() =>
        apiFetch(`/api/v1/admin/modalities/${modality.modality_id}/status`, {
          method: "POST",
          body: { status: next, ...(reason.trim() ? { reason: reason.trim() } : {}) },
        })
      }
    >
      <TextareaField id="status-reason" name="reason" label="Motivo (opcional)" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
    </FormDialog>
  );
}

function DeleteDialog({ modality, onClose }: { modality: ModalityRow; onClose: () => void }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Eliminar ${modality.name}`}
      description="Solo se puede mientras la edición es un borrador. Se elimina la modalidad con sus precios; no se puede deshacer."
      confirmLabel="Eliminar modalidad"
      tone="danger"
      onConfirm={() => apiFetch(`/api/v1/admin/modalities/${modality.modality_id}`, { method: "DELETE" })}
      onDone={() => {
        toast({ tone: "success", title: "Modalidad eliminada" });
        router.refresh();
      }}
    />
  );
}
