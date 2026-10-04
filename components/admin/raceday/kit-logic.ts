import { TZDate } from "@date-fns/tz";
import type { JsonObject } from "@/lib/shared/api-contract";

/**
 * Pure logic of the Kit Center (Master §86-89): definitions, variants and the in-person actions. The server validates everything again
 * (zod + database); these helpers only shape the request and stop an obviously wrong one before it is sent. Pickup windows are
 * written in the Edition's own timezone, never the browser's.
 */
export type FieldErrors = Record<string, string | undefined>;

export type KitVariantRow = {
  kit_variant_id: string;
  variant_key: string;
  label: string;
  status: string;
  capacity: number | null;
  allocated_count: number;
  delivered_count: number;
  pending_count: number;
  exception_count: number;
  available: number | null;
};

export type KitRow = {
  kit_definition_id: string;
  name: string;
  status: string;
  pickup_start_at: string | null;
  pickup_end_at: string | null;
  instructions: string | null;
  variants: KitVariantRow[];
};

// ---- Timezone-aware pickup window --------------------------------------------------------------------------------------------

/** "2026-10-03T07:00" typed in the Edition's zone -> an absolute instant (ISO, UTC). Null when it is not a real local time. */
export function localInputToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  let instant: TZDate;
  try {
    instant = new TZDate(year, month - 1, day, hour, minute, 0, timeZone);
  } catch {
    return null;
  }
  if (Number.isNaN(instant.getTime())) return null;
  // Reject a calendar overflow such as 31 February, which Date would silently roll into March.
  if (instant.getFullYear() !== year || instant.getMonth() !== month - 1 || instant.getDate() !== day) return null;
  return new Date(instant.getTime()).toISOString();
}

/** An instant -> the "YYYY-MM-DDTHH:mm" a datetime-local field shows, in the Edition's zone. */
export function isoToLocalInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  } catch {
    return "";
  }
}

// ---- Definition ----------------------------------------------------------------------------------------------------------------

export type KitDefinitionValues = {
  name: string;
  status: "ACTIVE" | "INACTIVE";
  pickup_start: string;
  pickup_end: string;
  instructions: string;
};

export function emptyKitDefinition(): KitDefinitionValues {
  return { name: "", status: "ACTIVE", pickup_start: "", pickup_end: "", instructions: "" };
}

export function kitToValues(kit: KitRow, timeZone: string): KitDefinitionValues {
  return {
    name: kit.name,
    status: kit.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    pickup_start: isoToLocalInput(kit.pickup_start_at, timeZone),
    pickup_end: isoToLocalInput(kit.pickup_end_at, timeZone),
    instructions: kit.instructions ?? "",
  };
}

export function validateKitDefinition(values: KitDefinitionValues, timeZone: string): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  if (name.length === 0) errors.name = "Escribe el nombre del kit.";
  else if (name.length > 120) errors.name = "Máximo 120 caracteres.";
  if (values.instructions.trim().length > 2000) errors.instructions = "Máximo 2000 caracteres.";
  const start = values.pickup_start ? localInputToIso(values.pickup_start, timeZone) : null;
  const end = values.pickup_end ? localInputToIso(values.pickup_end, timeZone) : null;
  if (values.pickup_start && !start) errors.pickup_start = "Esa fecha y hora no es válida.";
  if (values.pickup_end && !end) errors.pickup_end = "Esa fecha y hora no es válida.";
  if (start && end && new Date(end).getTime() <= new Date(start).getTime()) errors.pickup_end = "El cierre debe ser posterior a la apertura.";
  return errors;
}

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

export function buildKitDefinitionBody(values: KitDefinitionValues, timeZone: string, variants: readonly VariantValues[] = []): JsonObject {
  const body: JsonObject = { name: values.name.trim(), status: values.status };
  const start = values.pickup_start ? localInputToIso(values.pickup_start, timeZone) : null;
  const end = values.pickup_end ? localInputToIso(values.pickup_end, timeZone) : null;
  if (start) body.pickup_start_at = start;
  if (end) body.pickup_end_at = end;
  if (values.instructions.trim()) body.instructions = values.instructions.trim();
  if (variants.length > 0) body.variants = variants.map((variant) => buildVariantBody(variant));
  return body;
}

/** PATCH body: only what changed, with "" clearing an optional value (null). Null when nothing changed. */
export function buildKitDefinitionPatch(initial: KitDefinitionValues, values: KitDefinitionValues, timeZone: string): JsonObject | null {
  const patch: JsonObject = {};
  if (values.name.trim() !== initial.name.trim()) patch.name = values.name.trim();
  if (values.status !== initial.status) patch.status = values.status;
  if (values.pickup_start !== initial.pickup_start) patch.pickup_start_at = values.pickup_start ? localInputToIso(values.pickup_start, timeZone) : null;
  if (values.pickup_end !== initial.pickup_end) patch.pickup_end_at = values.pickup_end ? localInputToIso(values.pickup_end, timeZone) : null;
  if (values.instructions.trim() !== initial.instructions.trim()) patch.instructions = values.instructions.trim() || null;
  return Object.keys(patch).length > 0 ? patch : null;
}

// ---- Variant ---------------------------------------------------------------------------------------------------------------------

export type VariantValues = { variant_key: string; label: string; capacity: string; status: "ACTIVE" | "INACTIVE" };

export const VARIANT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
export const SIZE_PRESETS = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export function emptyVariant(): VariantValues {
  return { variant_key: "", label: "", capacity: "", status: "ACTIVE" };
}

export function variantToValues(variant: KitVariantRow): VariantValues {
  return {
    variant_key: variant.variant_key,
    label: variant.label,
    capacity: variant.capacity === null ? "" : String(variant.capacity),
    status: variant.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  };
}

export function parseCapacity(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,7}$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  return value > 1_000_000 ? "invalid" : value;
}

export function validateVariant(values: VariantValues, options: { editing: boolean }): FieldErrors {
  const errors: FieldErrors = {};
  if (!options.editing && !VARIANT_KEY_PATTERN.test(values.variant_key.trim())) errors.variant_key = "Usa 1 a 32 letras, números, guion o guion bajo, sin espacios.";
  const label = values.label.trim();
  if (label.length === 0) errors.label = "Escribe cómo se llama (por ejemplo «Talla M»).";
  else if (label.length > 80) errors.label = "Máximo 80 caracteres.";
  if (parseCapacity(values.capacity) === "invalid") errors.capacity = "Escribe un número entero de 0 a 1,000,000, o déjalo vacío para no limitar.";
  return errors;
}

export function buildVariantBody(values: VariantValues): JsonObject {
  const capacity = parseCapacity(values.capacity);
  return {
    variant_key: values.variant_key.trim(),
    label: values.label.trim(),
    status: values.status,
    ...(typeof capacity === "number" ? { capacity } : {}),
  };
}

/** PATCH of a variant. `capacity: null` removes the limit; below the live allocations the server asks for an explicit acknowledgement. */
export function buildVariantPatch(initial: VariantValues, values: VariantValues, acknowledgeBelowAllocation: boolean): JsonObject | null {
  const patch: JsonObject = {};
  if (values.label.trim() !== initial.label.trim()) patch.label = values.label.trim();
  if (values.status !== initial.status) patch.status = values.status;
  if (values.capacity.trim() !== initial.capacity.trim()) {
    const capacity = parseCapacity(values.capacity);
    patch.capacity = typeof capacity === "number" ? capacity : null;
  }
  if (Object.keys(patch).length === 0) return null;
  if (acknowledgeBelowAllocation && "capacity" in patch) patch.acknowledge_below_allocation = true;
  return patch;
}

/** True when the typed capacity is under what is already allocated: the operator must acknowledge it before saving. */
export function isBelowAllocation(capacityText: string, allocated: number): boolean {
  const capacity = parseCapacity(capacityText);
  return typeof capacity === "number" && capacity < allocated;
}

// ---- In-person actions ---------------------------------------------------------------------------------------------------------

export function validateReason(reason: string, label = "El motivo"): string | undefined {
  const text = reason.trim();
  if (text.length === 0) return `${label} es obligatorio: queda como evidencia.`;
  if (text.length > 500) return "Máximo 500 caracteres.";
  return undefined;
}

export type InventoryTotals = { allocated: number; delivered: number; pending: number; exceptions: number };

export function inventoryTotals(kits: readonly KitRow[]): InventoryTotals {
  const totals: InventoryTotals = { allocated: 0, delivered: 0, pending: 0, exceptions: 0 };
  for (const kit of kits) {
    for (const variant of kit.variants) {
      totals.allocated += variant.allocated_count;
      totals.delivered += variant.delivered_count;
      totals.pending += variant.pending_count;
      totals.exceptions += variant.exception_count;
    }
  }
  return totals;
}

/** A variant is "low" when little stock is left (never for unlimited ones). */
export function isLowStock(variant: Pick<KitVariantRow, "capacity" | "available" | "status">): boolean {
  if (variant.status !== "ACTIVE" || variant.capacity === null || variant.available === null) return false;
  return variant.available === 0 || variant.available <= Math.max(1, Math.floor(variant.capacity * 0.1));
}

export const KIT_STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Asignado",
  READY: "Listo para entregar",
  DELIVERED: "Entregado",
  CANCELED: "Cancelado",
  EXCEPTION: "Con excepción",
  NONE: "Sin kit",
};

// ---- Size change and reversal from the participant row (P3-Q D2) -------------------------------------------------------------------

/** The kit reference a participant row carries: the ids the two commands need (allocation for a size change, active pickup for a reversal). */
export type ParticipantKitRef = {
  status: string;
  kit_variant_id: string;
  variant_label: string;
  kit_allocation_id: string;
  kit_definition_id: string;
  /** The active DELIVERED pickup; null before a delivery and after a reversal. */
  kit_pickup_id: string | null;
};

export type SizeChoice = { kit_variant_id: string; label: string };

/** The server refuses a size change on a delivered or canceled allocation (ALREADY_DELIVERED / ALLOCATION_CANCELED): do not offer it. */
export function canChangeSize(kit: Pick<ParticipantKitRef, "status"> | null): boolean {
  return kit !== null && kit.status !== "DELIVERED" && kit.status !== "CANCELED";
}

/** A delivery can be reversed only while it has an active pickup to point at. */
export function canReverseDelivery(kit: Pick<ParticipantKitRef, "status" | "kit_pickup_id"> | null): boolean {
  return kit !== null && kit.status === "DELIVERED" && kit.kit_pickup_id !== null;
}

/** The other ACTIVE sizes of the SAME kit (the server only accepts a variant of the allocation's own kit). Capacity is judged by the server. */
export function sizeChoices(
  kit: Pick<ParticipantKitRef, "kit_definition_id" | "kit_variant_id">,
  kits: readonly { kit_definition_id: string; variants: readonly { kit_variant_id: string; label: string; status: string }[] }[],
): SizeChoice[] {
  const definition = kits.find((item) => item.kit_definition_id === kit.kit_definition_id);
  if (!definition) return [];
  return definition.variants
    .filter((variant) => variant.status === "ACTIVE" && variant.kit_variant_id !== kit.kit_variant_id)
    .map((variant) => ({ kit_variant_id: variant.kit_variant_id, label: variant.label }));
}

export type SizeChangeDecision =
  | { ok: true; body: { new_kit_variant_id: string; reason: string } }
  | { ok: false; errors: { size?: string; reason?: string } };

export function buildSizeChange(input: { newVariantId: string; currentVariantId: string; choices: readonly SizeChoice[]; reason: string }): SizeChangeDecision {
  const errors: { size?: string; reason?: string } = {};
  if (!input.newVariantId) errors.size = "Elige la talla nueva.";
  else if (input.newVariantId === input.currentVariantId) errors.size = "Elige una talla distinta de la actual.";
  else if (!input.choices.some((choice) => choice.kit_variant_id === input.newVariantId)) errors.size = "Esa talla no está disponible para este kit.";
  const reasonError = validateReason(input.reason);
  if (reasonError) errors.reason = reasonError;
  if (errors.size || errors.reason) return { ok: false, errors };
  return { ok: true, body: { new_kit_variant_id: input.newVariantId, reason: input.reason.trim() } };
}

export function sizeChangePath(kitAllocationId: string): string {
  return `/api/v1/admin/kits/allocations/${encodeURIComponent(kitAllocationId)}/size`;
}

export function reversePickupPath(kitPickupId: string): string {
  return `/api/v1/admin/kits/pickup/${encodeURIComponent(kitPickupId)}/reverse`;
}
