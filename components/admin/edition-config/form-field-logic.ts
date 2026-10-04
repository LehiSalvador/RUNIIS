import type { JsonObject } from "@/lib/shared/api-contract";
import { slugify } from "@/components/admin/events/form-logic";

/**
 * Pure logic of the registration-form field editor (P3-E2, Master §41). A form version is a list of fields; the draft is edited as a
 * whole and sent with PUT /api/v1/admin/forms/:id/fields (the API replaces the full list). The rules mirrored here are the edge
 * of private.cfg_form_field: they only spare a round trip, the database stays the authority and reports the field it refuses.
 */

export type FormFieldType = "TEXT" | "TEXTAREA" | "SELECT" | "MULTISELECT" | "BOOLEAN" | "DATE" | "NUMBER";

export const FIELD_TYPE_OPTIONS: readonly { value: FormFieldType; label: string }[] = [
  { value: "TEXT", label: "Texto corto" },
  { value: "TEXTAREA", label: "Texto largo" },
  { value: "SELECT", label: "Lista (una opción)" },
  { value: "MULTISELECT", label: "Lista (varias opciones)" },
  { value: "BOOLEAN", label: "Sí / No" },
  { value: "DATE", label: "Fecha" },
  { value: "NUMBER", label: "Número" },
];

export const FIELD_TYPE_LABEL: Record<FormFieldType, string> = Object.fromEntries(
  FIELD_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<FormFieldType, string>;

export const MAX_FORM_FIELDS = 50;
export const MAX_OPTIONS = 100;

export type OptionDraft = { uid: string; value: string; label: string };

export type FieldDraft = {
  /** Client-only identity, so rows keep their state while they are reordered. */
  uid: string;
  field_key: string;
  /** The key follows the label until the operator edits it by hand (or it came from the server). */
  keyTouched: boolean;
  label: string;
  field_type: FormFieldType;
  required: boolean;
  sensitivity: "NORMAL" | "SENSITIVE";
  min_length: string;
  max_length: string;
  min: string;
  max: string;
  integer: boolean;
  min_date: string;
  max_date: string;
  min_items: string;
  max_items: string;
  options: OptionDraft[];
};

let counter = 0;
export function nextUid(prefix = "u"): string {
  counter += 1;
  return `${prefix}${counter}`;
}

export function newFieldDraft(type: FormFieldType = "TEXT"): FieldDraft {
  return {
    uid: nextUid("f"),
    field_key: "",
    keyTouched: false,
    label: "",
    field_type: type,
    required: false,
    sensitivity: "NORMAL",
    min_length: "",
    max_length: "",
    min: "",
    max: "",
    integer: false,
    min_date: "",
    max_date: "",
    min_items: "",
    max_items: "",
    options: [],
  };
}

export function newOption(): OptionDraft {
  return { uid: nextUid("o"), value: "", label: "" };
}

/** "Talla de playera" -> "talla_de_playera": the server key rule is ^[a-z][a-z0-9_]{0,63}$. */
export function fieldKeyFromLabel(label: string): string {
  const base = slugify(label).replace(/-/g, "_").replace(/^[^a-z]+/, "");
  return base.slice(0, 64).replace(/_+$/g, "");
}

export function isValidFieldKey(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value);
}

export function isValidOptionValue(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(value);
}

/** "Talla S" -> "talla_s": the stored value of an option typed only as a label. */
export function optionValueFromLabel(label: string): string {
  return slugify(label).replace(/-/g, "_").slice(0, 64).replace(/_+$/g, "");
}

export type ServerFormField = {
  field_key: string;
  label: string;
  field_type: FormFieldType;
  required: boolean;
  validation_config: Record<string, unknown>;
  options_config: Record<string, unknown>;
  sensitivity: "NORMAL" | "SENSITIVE";
};

function numberText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
function stringText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function fieldDraftFromServer(field: ServerFormField): FieldDraft {
  const validation = field.validation_config ?? {};
  const rawOptions = (field.options_config as { options?: unknown } | undefined)?.options;
  const options: OptionDraft[] = [];
  if (Array.isArray(rawOptions)) {
    for (const item of rawOptions) {
      if (item && typeof item === "object") {
        const { value, label } = item as { value?: unknown; label?: unknown };
        if (typeof value === "string") options.push({ uid: nextUid("o"), value, label: typeof label === "string" ? label : value });
      }
    }
  }
  return {
    uid: nextUid("f"),
    field_key: field.field_key,
    keyTouched: true,
    label: field.label,
    field_type: field.field_type,
    required: field.required,
    sensitivity: field.sensitivity,
    min_length: numberText(validation.min_length),
    max_length: numberText(validation.max_length),
    min: numberText(validation.min),
    max: numberText(validation.max),
    integer: validation.integer === true,
    min_date: stringText(validation.min_date),
    max_date: stringText(validation.max_date),
    min_items: numberText(validation.min_items),
    max_items: numberText(validation.max_items),
    options,
  };
}

export const hasOptions = (type: FormFieldType) => type === "SELECT" || type === "MULTISELECT";

function textLimit(type: FormFieldType): number {
  return type === "TEXT" ? 200 : 2000;
}

/** Body of one field for PUT /forms/:id/fields. Only the settings that belong to the type are sent. */
export function buildFieldBody(draft: FieldDraft, index: number): JsonObject {
  const validation: JsonObject = {};
  const num = (text: string) => Number(text.trim());
  const filled = (text: string) => text.trim() !== "";
  switch (draft.field_type) {
    case "TEXT":
    case "TEXTAREA":
      if (filled(draft.min_length)) validation.min_length = num(draft.min_length);
      if (filled(draft.max_length)) validation.max_length = num(draft.max_length);
      break;
    case "NUMBER":
      if (filled(draft.min)) validation.min = num(draft.min);
      if (filled(draft.max)) validation.max = num(draft.max);
      if (draft.integer) validation.integer = true;
      break;
    case "DATE":
      if (draft.min_date) validation.min_date = draft.min_date;
      if (draft.max_date) validation.max_date = draft.max_date;
      break;
    case "MULTISELECT":
      if (filled(draft.min_items)) validation.min_items = num(draft.min_items);
      if (filled(draft.max_items)) validation.max_items = num(draft.max_items);
      break;
    default:
      break;
  }
  return {
    field_key: draft.field_key,
    label: draft.label.trim(),
    field_type: draft.field_type,
    required: draft.required,
    sensitivity: draft.sensitivity,
    sort_order: index + 1,
    validation_config: validation,
    options_config: hasOptions(draft.field_type) ? { options: draft.options.map((option) => ({ value: option.value, label: option.label.trim() })) } : {},
  };
}

export function buildFieldsBody(drafts: readonly FieldDraft[]): JsonObject {
  return { fields: drafts.map((draft, index) => buildFieldBody(draft, index)) };
}

/** Stable text of the list as it would be sent: equal text = nothing to save. */
export function fieldsSignature(drafts: readonly FieldDraft[]): string {
  return JSON.stringify(drafts.map((draft, index) => buildFieldBody(draft, index)));
}

export type FieldDraftErrors = Partial<Record<string, string>>;

const NUMERIC = /^-?\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Errors per draft uid. An empty result means the whole list can be sent. */
export function validateFieldDrafts(drafts: readonly FieldDraft[]): Record<string, FieldDraftErrors> {
  const result: Record<string, FieldDraftErrors> = {};
  const seenKeys = new Set<string>();
  const put = (uid: string, name: string, message: string) => {
    (result[uid] ??= {})[name] = message;
  };

  for (const draft of drafts) {
    if (!draft.label.trim()) put(draft.uid, "label", "Escribe la pregunta tal como la verá la persona.");
    else if (draft.label.trim().length > 160) put(draft.uid, "label", "Máximo 160 caracteres.");

    if (!draft.field_key) put(draft.uid, "field_key", "La clave es obligatoria.");
    else if (!isValidFieldKey(draft.field_key)) put(draft.uid, "field_key", "Minúsculas, números y guion bajo; empieza con letra (máx. 64).");
    else if (seenKeys.has(draft.field_key)) put(draft.uid, "field_key", "Otra pregunta ya usa esta clave.");
    else seenKeys.add(draft.field_key);

    const limit = textLimit(draft.field_type);
    const intInRange = (name: string, text: string, low: number, high: number): number | null => {
      if (text.trim() === "") return null;
      if (!/^\d+$/.test(text.trim()) || Number(text) < low || Number(text) > high) {
        put(draft.uid, name, `Entero entre ${low} y ${high}.`);
        return null;
      }
      return Number(text);
    };

    if (draft.field_type === "TEXT" || draft.field_type === "TEXTAREA") {
      const low = intInRange("min_length", draft.min_length, 0, limit);
      const high = intInRange("max_length", draft.max_length, 1, limit);
      if (low !== null && high !== null && low > high) put(draft.uid, "max_length", "El máximo no puede ser menor que el mínimo.");
    }
    if (draft.field_type === "NUMBER") {
      const bound = (name: string, text: string): number | null => {
        if (text.trim() === "") return null;
        if (!NUMERIC.test(text.trim()) || Math.abs(Number(text)) > 1_000_000_000) {
          put(draft.uid, name, "Número entre -1,000,000,000 y 1,000,000,000.");
          return null;
        }
        return Number(text);
      };
      const low = bound("min", draft.min);
      const high = bound("max", draft.max);
      if (low !== null && high !== null && low > high) put(draft.uid, "max", "El máximo no puede ser menor que el mínimo.");
    }
    if (draft.field_type === "DATE") {
      if (draft.min_date && !DATE.test(draft.min_date)) put(draft.uid, "min_date", "Fecha no válida.");
      if (draft.max_date && !DATE.test(draft.max_date)) put(draft.uid, "max_date", "Fecha no válida.");
      if (draft.min_date && draft.max_date && draft.min_date > draft.max_date) put(draft.uid, "max_date", "La fecha máxima no puede ser anterior a la mínima.");
    }
    if (hasOptions(draft.field_type)) {
      if (draft.options.length === 0) put(draft.uid, "options", "Agrega al menos una opción.");
      else if (draft.options.length > MAX_OPTIONS) put(draft.uid, "options", `Máximo ${MAX_OPTIONS} opciones.`);
      const values = new Set<string>();
      for (const option of draft.options) {
        if (!option.label.trim()) put(draft.uid, `option:${option.uid}:label`, "Escribe la etiqueta.");
        else if (option.label.trim().length > 120) put(draft.uid, `option:${option.uid}:label`, "Máximo 120 caracteres.");
        if (!option.value) put(draft.uid, `option:${option.uid}:value`, "El valor es obligatorio.");
        else if (!isValidOptionValue(option.value)) put(draft.uid, `option:${option.uid}:value`, "Letras, números, punto, guion o guion bajo (máx. 64).");
        else if (values.has(option.value)) put(draft.uid, `option:${option.uid}:value`, "Otra opción ya usa este valor.");
        else values.add(option.value);
      }
      if (draft.field_type === "MULTISELECT") {
        const count = draft.options.length;
        const low = intInRange("min_items", draft.min_items, 0, count);
        const high = intInRange("max_items", draft.max_items, 1, count);
        if (low !== null && high !== null && low > high) put(draft.uid, "max_items", "El máximo no puede ser menor que el mínimo.");
      }
    }
  }
  if (drafts.length > MAX_FORM_FIELDS) put(drafts[MAX_FORM_FIELDS].uid, "label", `Un formulario admite hasta ${MAX_FORM_FIELDS} preguntas.`);
  return result;
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** One-line description of a field's rules, for the read-only list of a published form. */
export function describeFieldRules(field: {
  field_type: FormFieldType;
  required: boolean;
  validation_config: Record<string, unknown>;
  options_config: Record<string, unknown>;
  sensitivity: string;
}): string {
  const parts: string[] = [FIELD_TYPE_LABEL[field.field_type] ?? field.field_type, field.required ? "obligatorio" : "opcional"];
  const v = field.validation_config ?? {};
  const range = (low: unknown, high: unknown, unit: string) => {
    if (typeof low === "number" && typeof high === "number") parts.push(`${low} a ${high} ${unit}`.trim());
    else if (typeof low === "number") parts.push(`mínimo ${low} ${unit}`.trim());
    else if (typeof high === "number") parts.push(`máximo ${high} ${unit}`.trim());
  };
  if (field.field_type === "TEXT" || field.field_type === "TEXTAREA") range(v.min_length, v.max_length, "caracteres");
  if (field.field_type === "NUMBER") {
    range(v.min, v.max, "");
    if (v.integer === true) parts.push("entero");
  }
  if (field.field_type === "DATE") {
    if (typeof v.min_date === "string" && typeof v.max_date === "string") parts.push(`${v.min_date} a ${v.max_date}`);
    else if (typeof v.min_date === "string") parts.push(`desde ${v.min_date}`);
    else if (typeof v.max_date === "string") parts.push(`hasta ${v.max_date}`);
  }
  if (field.field_type === "MULTISELECT") range(v.min_items, v.max_items, "elecciones");
  const options = (field.options_config as { options?: unknown } | undefined)?.options;
  if ((field.field_type === "SELECT" || field.field_type === "MULTISELECT") && Array.isArray(options)) parts.push(`${options.length} ${options.length === 1 ? "opción" : "opciones"}`);
  if (field.sensitivity === "SENSITIVE") parts.push("dato sensible");
  return parts.join(" · ");
}
