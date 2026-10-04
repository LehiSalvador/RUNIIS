import type { JsonObject } from "@/lib/shared/api-contract";
import type { ApiFailure } from "@/lib/client/api";
import { describeFailure, type AdminErrorView } from "@/components/admin/errors";
import { readinessLabel } from "@/components/admin/readiness-checklist";

/**
 * Pure form logic for the staff event/edition screens (P3-E1): date and time conversion in the Edition's own
 * IANA zone, slug and money helpers, field validation and the PATCH diff. No React, no I/O, so each rule has a
 * unit test. The SERVER stays the authority: everything here only spares an operator a round trip on a value
 * the API is sure to refuse; business rules (states, readiness, capacity) are never decided on the client.
 */

export const DEFAULT_TIMEZONE = "America/Monterrey";

/** Zones offered in the edition form. The server validates the IANA name; this is only the picker. */
export const TIMEZONE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "America/Monterrey", label: "Monterrey (Centro, sin horario de verano)" },
  { value: "America/Mexico_City", label: "Ciudad de México (Centro)" },
  { value: "America/Chihuahua", label: "Chihuahua (Centro)" },
  { value: "America/Mazatlan", label: "Mazatlán (Pacífico)" },
  { value: "America/Tijuana", label: "Tijuana (Pacífico, con horario de verano)" },
  { value: "America/Cancun", label: "Cancún (Sureste)" },
];

// ---------------------------------------------------------------------------------------------
// Date and time in the Edition timezone
// ---------------------------------------------------------------------------------------------

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function zonedParts(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  // The wall-clock reading of the instant, expressed as if it were UTC.
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

/** Offset of the zone from UTC at an instant, in ms (positive east of Greenwich). */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  return zonedParts(Math.floor(utcMs / 1000) * 1000, timeZone) - Math.floor(utcMs / 1000) * 1000;
}

function offsetLabel(offsetMs: number): string {
  const minutes = Math.round(offsetMs / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A wall-clock reading typed by the operator ("2026-10-05T06:30") in the Edition's zone, as an ISO instant with an
 * explicit offset ("2026-10-05T06:30:00-06:00"), which is what the API accepts. Null when the text is not a real
 * date-time (or the zone is unknown).
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match || !isValidTimeZone(timeZone)) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const probe = new Date(guess);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  // Two passes settle the offset around a daylight-saving change.
  const first = zoneOffsetMs(guess, timeZone);
  const offset = zoneOffsetMs(guess - first, timeZone);
  return `${local}:00${offsetLabel(offset)}`;
}

/** The inverse: an ISO instant as the "YYYY-MM-DDTHH:mm" reading of the Edition's zone (for datetime-local). */
export function isoToZonedLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const instant = new Date(iso).getTime();
  if (Number.isNaN(instant) || !isValidTimeZone(timeZone)) return "";
  const wall = new Date(zonedParts(instant, timeZone));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

/** "06:30:00" -> "06:30" (what an <input type="time"> shows). */
export function toTimeInput(value: string | null | undefined): string {
  const match = value ? /^(\d{2}):(\d{2})/.exec(value) : null;
  return match ? `${match[1]}:${match[2]}` : "";
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

/** Lowercase ASCII slug ("Carrera Atlética 5K" -> "carrera-atletica-5k"), within the server's 120-character limit. */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

export function isValidSlug(value: string): boolean {
  return value.length >= 3 && value.length <= 120 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

/** Modality/category keys: lowercase identifiers joined by "_" or "-" (server rule). */
export function keyify(text: string): string {
  return slugify(text).slice(0, 64).replace(/-+$/g, "");
}

export function isValidKey(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && /^[a-z0-9]+([_-][a-z0-9]+)*$/.test(value);
}

export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

// ---------------------------------------------------------------------------------------------
// Money (V1 payment model: prices are informational for FREE / EXTERNAL_WHATSAPP; amounts in MXN minor units)
// ---------------------------------------------------------------------------------------------

/** "250", "250.5", "$1,250.00" -> minor units (cents); null when it is not a non-negative amount with up to 2 decimals. */
export function parseMoneyToMinor(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "").replace(/\s/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(minor) && minor <= 100_000_000 ? minor : null;
}

export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function formatMoney(minor: number, currency = "MXN"): string {
  if (minor === 0) return "Gratis";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(minor / 100);
}

export function formatDistance(meters: number | null): string {
  return meters ? `${(meters / 1000).toLocaleString("es-MX", { maximumFractionDigits: 3 })} km` : "Sin distancia oficial";
}

/** Whole kilometres/decimals typed by the operator ("10", "5.5") -> metres; null when invalid. */
export function kmToMeters(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const meters = Math.round(Number(cleaned) * 1000);
  return meters >= 1 && meters <= 1_000_000 ? meters : null;
}

export function metersToKmInput(meters: number | null): string {
  return meters ? String(meters / 1000) : "";
}

/** "" -> null; otherwise a non-negative integer or undefined when invalid. */
export function parseOptionalCount(text: string): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed <= 1_000_000 ? parsed : undefined;
}

// ---------------------------------------------------------------------------------------------
// Edition form
// ---------------------------------------------------------------------------------------------

export type RegistrationMode = "FREE" | "EXTERNAL_WHATSAPP";

export type EditionFormValues = {
  name: string;
  slug: string;
  registration_mode: RegistrationMode;
  timezone: string;
  city: string;
  state_region: string;
  country_code: string;
  local_date: string;
  local_start_time: string;
  local_end_time: string;
  /** datetime-local readings in the Edition timezone. */
  registration_open_at: string;
  registration_close_at: string;
  global_capacity: string;
  whatsapp_phone_e164: string;
  is_benefit_event: boolean;
};

export function emptyEditionValues(): EditionFormValues {
  return {
    name: "",
    slug: "",
    registration_mode: "EXTERNAL_WHATSAPP",
    timezone: DEFAULT_TIMEZONE,
    city: "",
    state_region: "",
    country_code: "MX",
    local_date: "",
    local_start_time: "",
    local_end_time: "",
    registration_open_at: "",
    registration_close_at: "",
    global_capacity: "",
    whatsapp_phone_e164: "",
    is_benefit_event: false,
  };
}

export type EditionLike = {
  name: string;
  slug: string;
  registration_mode: RegistrationMode;
  timezone: string;
  city: string;
  state_region: string;
  country_code: string;
  registration_open_at: string | null;
  registration_close_at: string;
  global_capacity: number | null;
  whatsapp_phone_e164: string | null;
  is_benefit_event: boolean;
  schedule: { local_date: string | null; local_start_time: string | null; local_end_time: string | null } | null;
};

export function editionToFormValues(edition: EditionLike): EditionFormValues {
  return {
    name: edition.name,
    slug: edition.slug,
    registration_mode: edition.registration_mode,
    timezone: edition.timezone,
    city: edition.city,
    state_region: edition.state_region,
    country_code: edition.country_code,
    local_date: edition.schedule?.local_date ?? "",
    local_start_time: toTimeInput(edition.schedule?.local_start_time),
    local_end_time: toTimeInput(edition.schedule?.local_end_time),
    registration_open_at: isoToZonedLocal(edition.registration_open_at, edition.timezone),
    registration_close_at: isoToZonedLocal(edition.registration_close_at, edition.timezone),
    global_capacity: edition.global_capacity === null ? "" : String(edition.global_capacity),
    whatsapp_phone_e164: edition.whatsapp_phone_e164 ?? "",
    is_benefit_event: edition.is_benefit_event,
  };
}

export type FieldErrors = Partial<Record<string, string>>;

const REQUIRED = "Este campo es obligatorio.";

/** Edge validation only; the database keeps every business rule (it re-validates and reports the field). */
export function validateEditionValues(values: EditionFormValues, mode: "create" | "edit"): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = REQUIRED;
  else if (values.name.trim().length > 160) errors.name = "Máximo 160 caracteres.";
  if (!values.slug) errors.slug = REQUIRED;
  else if (!isValidSlug(values.slug)) errors.slug = "Usa de 3 a 120 caracteres: minúsculas, números y guiones (ej. carrera-5k-2026).";
  if (!values.city.trim()) errors.city = REQUIRED;
  if (!values.state_region.trim()) errors.state_region = REQUIRED;
  if (!/^[A-Za-z]{2}$/.test(values.country_code.trim())) errors.country_code = "Código de país de 2 letras (ej. MX).";
  if (!isValidTimeZone(values.timezone)) errors.timezone = "Zona horaria no reconocida.";
  if (values.whatsapp_phone_e164 && !isValidE164(values.whatsapp_phone_e164)) {
    errors.whatsapp_phone_e164 = "Formato internacional con +, sin espacios (ej. +528110814941).";
  }
  if (values.global_capacity.trim() !== "" && parseOptionalCount(values.global_capacity) === undefined) {
    errors.global_capacity = "Número entero, 0 o mayor.";
  }
  if (values.local_start_time && !values.local_date) errors.local_date = "Indica la fecha para fijar la hora.";
  if (values.local_end_time && !values.local_start_time) errors.local_end_time = "Indica primero la hora de inicio.";
  if (values.local_start_time && values.local_end_time && values.local_end_time <= values.local_start_time) {
    errors.local_end_time = "La hora de término debe ser posterior a la de inicio.";
  }
  const open = values.registration_open_at ? zonedLocalToIso(values.registration_open_at, values.timezone) : null;
  const close = values.registration_close_at ? zonedLocalToIso(values.registration_close_at, values.timezone) : null;
  if (values.registration_open_at && !open) errors.registration_open_at = "Fecha y hora no válidas.";
  if (values.registration_close_at && !close) errors.registration_close_at = "Fecha y hora no válidas.";
  if (open && close && new Date(open).getTime() >= new Date(close).getTime()) {
    errors.registration_open_at = "La apertura debe ser anterior al cierre de inscripciones.";
  }
  if (mode === "create" && !values.registration_close_at && !values.local_date) {
    errors.registration_close_at = "Sin fecha de carrera, indica el cierre de inscripciones.";
  }
  return errors;
}

/** Body for POST /api/v1/admin/editions (without event_id). Empty optional fields are omitted. */
export function buildCreateEditionBody(values: EditionFormValues): JsonObject {
  const body: JsonObject = {
    slug: values.slug,
    name: values.name.trim(),
    registration_mode: values.registration_mode,
    timezone: values.timezone,
    city: values.city.trim(),
    state_region: values.state_region.trim(),
    country_code: values.country_code.trim().toUpperCase(),
    is_benefit_event: values.is_benefit_event,
  };
  const open = values.registration_open_at ? zonedLocalToIso(values.registration_open_at, values.timezone) : null;
  const close = values.registration_close_at ? zonedLocalToIso(values.registration_close_at, values.timezone) : null;
  if (open) body.registration_open_at = open;
  if (close) body.registration_close_at = close;
  const capacity = parseOptionalCount(values.global_capacity);
  if (typeof capacity === "number") body.global_capacity = capacity;
  if (values.whatsapp_phone_e164) body.whatsapp_phone_e164 = values.whatsapp_phone_e164;
  if (values.local_date) {
    const schedule: JsonObject = { local_date: values.local_date };
    if (values.local_start_time) schedule.local_start_time = values.local_start_time;
    if (values.local_end_time) schedule.local_end_time = values.local_end_time;
    body.schedule = schedule;
  }
  return body;
}

export type EditionChanges = {
  /** Body for PATCH /api/v1/admin/editions/:id; null when nothing in it changed. */
  patch: JsonObject | null;
  /** Body for POST /api/v1/admin/editions/:id/schedule; null when date and times are unchanged. */
  schedule: JsonObject | null;
  /** Human labels of what changes, for the summary. */
  labels: string[];
};

const FIELD_LABEL: Record<string, string> = {
  name: "Nombre",
  slug: "Enlace público",
  timezone: "Zona horaria",
  city: "Ciudad",
  state_region: "Estado",
  country_code: "País",
  registration_mode: "Modo de inscripción",
  registration_open_at: "Apertura de inscripciones",
  registration_close_at: "Cierre de inscripciones",
  whatsapp_phone_e164: "WhatsApp de la edición",
  is_benefit_event: "Evento a beneficio",
  schedule: "Fecha y hora de la carrera",
};

/**
 * Diff of the form against the saved Edition: only changed fields travel, so an operator (who may not touch the
 * registration mode or window) never sends a field the server would refuse just for being present.
 * `canLifecycle` (ADMIN) decides whether the registration mode/window fields may be sent at all.
 */
export function buildEditionChanges(baseline: EditionFormValues, values: EditionFormValues, canLifecycle: boolean): EditionChanges {
  const patch: JsonObject = {};
  const labels: string[] = [];
  const mark = (field: string) => labels.push(FIELD_LABEL[field] ?? field);

  if (values.name.trim() !== baseline.name) { patch.name = values.name.trim(); mark("name"); }
  if (values.slug !== baseline.slug) { patch.slug = values.slug; mark("slug"); }
  if (values.timezone !== baseline.timezone) { patch.timezone = values.timezone; mark("timezone"); }
  if (values.city.trim() !== baseline.city) { patch.city = values.city.trim(); mark("city"); }
  if (values.state_region.trim() !== baseline.state_region) { patch.state_region = values.state_region.trim(); mark("state_region"); }
  if (values.country_code.trim().toUpperCase() !== baseline.country_code) { patch.country_code = values.country_code.trim().toUpperCase(); mark("country_code"); }
  if (values.whatsapp_phone_e164 !== baseline.whatsapp_phone_e164) { patch.whatsapp_phone_e164 = values.whatsapp_phone_e164 || null; mark("whatsapp_phone_e164"); }
  if (values.is_benefit_event !== baseline.is_benefit_event) { patch.is_benefit_event = values.is_benefit_event; mark("is_benefit_event"); }

  if (canLifecycle) {
    if (values.registration_mode !== baseline.registration_mode) { patch.registration_mode = values.registration_mode; mark("registration_mode"); }
    if (values.registration_open_at !== baseline.registration_open_at) {
      patch.registration_open_at = values.registration_open_at ? zonedLocalToIso(values.registration_open_at, values.timezone) : null;
      mark("registration_open_at");
    }
    if (values.registration_close_at !== baseline.registration_close_at && values.registration_close_at) {
      const close = zonedLocalToIso(values.registration_close_at, values.timezone);
      if (close) { patch.registration_close_at = close; mark("registration_close_at"); }
    }
  }

  let schedule: JsonObject | null = null;
  if (
    values.local_date &&
    (values.local_date !== baseline.local_date ||
      values.local_start_time !== baseline.local_start_time ||
      values.local_end_time !== baseline.local_end_time)
  ) {
    schedule = { local_date: values.local_date };
    if (values.local_start_time) schedule.local_start_time = values.local_start_time;
    if (values.local_end_time) schedule.local_end_time = values.local_end_time;
    mark("schedule");
  }

  return { patch: Object.keys(patch).length > 0 ? patch : null, schedule, labels };
}

export function sameEditionValues(a: EditionFormValues, b: EditionFormValues): boolean {
  return (Object.keys(a) as (keyof EditionFormValues)[]).every((key) => a[key] === b[key]);
}

// ---------------------------------------------------------------------------------------------
// Server refusal, in plain language
// ---------------------------------------------------------------------------------------------

const FIELD_NAME: Record<string, string> = {
  ...FIELD_LABEL,
  key: "Clave",
  canonical_key: "Clave del evento",
  event_type_key: "Tipo de evento",
  official_distance_m: "Distancia oficial",
  amount_minor: "Monto",
  ends_at: "Fin de vigencia",
  starts_at: "Inicio de vigencia",
  local_end_time: "Hora de término",
  local_start_time: "Hora de inicio",
  local_date: "Fecha",
  effective_capacity: "Capacidad",
  global_capacity: "Capacidad total",
  currency: "Moneda",
};

const REASON_TEXT: Record<string, string> = {
  taken: "ya existe otro registro con ese valor. Elige uno distinto.",
  required: "es obligatorio.",
  invalid_slug: "debe usar minúsculas, números y guiones.",
  invalid_key: "debe usar minúsculas y números, separados por guion o guion bajo.",
  invalid_timezone: "no es una zona horaria reconocida.",
  invalid_country_code: "debe ser un código de país de 2 letras.",
  invalid_currency: "debe ser un código de 3 letras (MXN).",
  must_precede_close: "debe ser anterior al cierre de inscripciones.",
  must_follow_open: "debe ser posterior a la apertura de inscripciones.",
  must_follow_start: "debe ser posterior al inicio.",
  required_without_schedule_date: "es obligatorio cuando la edición no tiene fecha de carrera.",
  required_for_distance_credit: "es obligatoria mientras la modalidad acredite distancia y las inscripciones estén abiertas o en pausa.",
  unknown: "no es un valor válido.",
  out_of_range: "está fuera del rango permitido.",
  invalid_length: "tiene una longitud no permitida.",
  must_be_integer: "debe ser un número entero.",
  min_exceeds_max: "la edad mínima no puede superar la máxima.",
  not_ready: "faltan requisitos para esta acción.",
  invalid_transition: "esta acción no aplica en el estado actual de la edición. Actualiza la pantalla para ver el estado vigente.",
  date_change_requires_reschedule: "con la edición publicada, cambiar la fecha requiere aplazar o reprogramar desde Estado y publicación.",
  schedule_unchanged: "la fecha y la hora son las mismas que ya tiene la edición.",
  locked_after_publication: "no se puede cambiar después de publicar la edición.",
  locked_after_registration_opened: "no se puede cambiar una vez abiertas las inscripciones o si ya hay solicitudes.",
  edition_not_configurable: "la edición ya terminó o se canceló: su configuración estructural está congelada.",
  edition_not_draft: "solo se puede hacer mientras la edición es un borrador.",
  event_archived: "el evento está archivado.",
  modality_in_use: "la modalidad ya tiene solicitudes; no se puede cambiar su clave.",
  price_offer_in_use: "el precio ya fue usado por una solicitud; crea una oferta nueva en lugar de cambiar el monto.",
  category_in_use: "la categoría ya tiene asignaciones; no se puede cambiar su clave.",
  capacity_below_occupation: "la capacidad quedaría por debajo de los lugares ocupados.",
  capacity_below_allocation: "la capacidad quedaría por debajo de lo ya asignado.",
};

export type RefusalView = {
  view: AdminErrorView;
  /** Plain-language lines from the server's own refusal reasons (never raw text). */
  reasons: string[];
  /** Readiness codes the server reported as failing (publish/open/resume). */
  failedChecks: string[];
  /** Set when the server reported that lowering capacity needs an explicit acknowledgement. */
  needsCapacityAcknowledgement: { confirmed: number; activeHolds: number } | null;
};

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Turns an API failure into the shared error view plus the server's concrete reasons. */
export function describeRefusal(failure: Pick<ApiFailure, "code" | "requestId" | "details">): RefusalView {
  let view = describeFailure(failure);
  const details = failure.details ?? {};
  const reason = typeof details.reason === "string" ? details.reason : null;
  const field = typeof details.field === "string" ? details.field : null;
  const reasons: string[] = [];
  const failedChecks = Array.isArray(details.failed_checks) ? details.failed_checks.filter((code): code is string => typeof code === "string") : [];
  let needsCapacityAcknowledgement: RefusalView["needsCapacityAcknowledgement"] = null;

  if (reason && REASON_TEXT[reason]) {
    const subject = field ? (FIELD_NAME[field] ?? field) : null;
    reasons.push(sentence(subject && reason !== "not_ready" && reason !== "invalid_transition" ? `${subject}: ${REASON_TEXT[reason]}` : REASON_TEXT[reason]));
  }
  if (reason === "taken") {
    view = { ...view, kind: "conflict", tone: "warning", title: "Ya existe", message: "Otro registro usa ese valor. Cámbialo y vuelve a guardar.", action: "fix" };
  } else if (reason === "invalid_transition") {
    view = { ...view, title: "La acción ya no aplica", message: "El estado de la edición cambió o no permite esta acción.", action: "reload" };
  } else if (reason === "not_ready") {
    view = { ...view, title: "Faltan requisitos", message: "El servidor rechazó la acción porque la edición aún no cumple lo necesario.", action: "none" };
  } else if (reason && REASON_TEXT[reason] && failure.code === "BUSINESS_RULE_VIOLATION") {
    view = { ...view, title: "No se puede en este estado", message: "El servidor rechazó el cambio por una regla de la edición.", action: "none" };
  }
  if (reason === "capacity_below_occupation") {
    const confirmed = typeof details.confirmed === "number" ? details.confirmed : 0;
    const activeHolds = typeof details.active_holds === "number" ? details.active_holds : 0;
    needsCapacityAcknowledgement = { confirmed, activeHolds };
    reasons.push(`Hay ${confirmed} confirmados y ${activeHolds} apartados vigentes; los registros existentes no se tocan.`);
  }
  if (failure.code === "VALIDATION_ERROR" && !reason && field) {
    reasons.push(sentence(`${FIELD_NAME[field] ?? field}: revisa el valor.`));
  }
  return { view, reasons, failedChecks, needsCapacityAcknowledgement };
}

export function failedCheckLabels(codes: readonly string[]): string[] {
  return codes.map(readinessLabel);
}

// ---------------------------------------------------------------------------------------------
// Eligibility (modalities and categories share the same rule shape: min_age, max_age, sex_codes)
// ---------------------------------------------------------------------------------------------

export type EligibilityRules = { min_age?: number; max_age?: number; sex_codes?: string[] };
export type EligibilityForm = { min_age: string; max_age: string; sex_codes: string[] };

export const SEX_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "F", label: "Femenil" },
  { value: "M", label: "Varonil" },
  { value: "X", label: "Otro / no binario" },
];

export function eligibilityToForm(rules: EligibilityRules | null | undefined): EligibilityForm {
  return {
    min_age: rules?.min_age === undefined ? "" : String(rules.min_age),
    max_age: rules?.max_age === undefined ? "" : String(rules.max_age),
    sex_codes: [...(rules?.sex_codes ?? [])],
  };
}

export function validateEligibility(form: EligibilityForm): FieldErrors {
  const errors: FieldErrors = {};
  const check = (field: "min_age" | "max_age") => {
    const text = form[field].trim();
    if (text === "") return null;
    if (!/^\d+$/.test(text) || Number(text) < 15 || Number(text) > 100) {
      errors[field] = "Entre 15 y 100 años.";
      return null;
    }
    return Number(text);
  };
  const min = check("min_age");
  const max = check("max_age");
  if (min !== null && max !== null && min > max) errors.max_age = "La edad máxima no puede ser menor que la mínima.";
  return errors;
}

/** Rules object for the API (only the filled criteria). An empty object means "sin restricciones". */
export function buildEligibility(form: EligibilityForm): EligibilityRules {
  const rules: EligibilityRules = {};
  if (form.min_age.trim() !== "") rules.min_age = Number(form.min_age);
  if (form.max_age.trim() !== "") rules.max_age = Number(form.max_age);
  if (form.sex_codes.length > 0) rules.sex_codes = [...form.sex_codes];
  return rules;
}

export function describeEligibility(rules: EligibilityRules | null | undefined): string {
  const parts: string[] = [];
  if (rules?.min_age !== undefined && rules?.max_age !== undefined) parts.push(`${rules.min_age} a ${rules.max_age} años`);
  else if (rules?.min_age !== undefined) parts.push(`${rules.min_age} años o más`);
  else if (rules?.max_age !== undefined) parts.push(`hasta ${rules.max_age} años`);
  if (rules?.sex_codes && rules.sex_codes.length > 0) {
    parts.push(rules.sex_codes.map((code) => SEX_OPTIONS.find((option) => option.value === code)?.label ?? code).join(", "));
  }
  return parts.length > 0 ? parts.join(" · ") : "Sin restricciones";
}

// ---------------------------------------------------------------------------------------------
// Modality / price forms
// ---------------------------------------------------------------------------------------------

export type ModalityFormValues = {
  key: string;
  name: string;
  distance_km: string;
  generates_distance_credit: boolean;
  local_start_time: string;
  sort_order: string;
  effective_capacity: string;
  eligibility: EligibilityForm;
};

export function emptyModalityValues(): ModalityFormValues {
  return {
    key: "",
    name: "",
    distance_km: "",
    generates_distance_credit: true,
    local_start_time: "",
    sort_order: "",
    effective_capacity: "",
    eligibility: { min_age: "", max_age: "", sex_codes: [] },
  };
}

export function validateModalityValues(values: ModalityFormValues, mode: "create" | "edit"): FieldErrors {
  const errors: FieldErrors = { ...validateEligibility(values.eligibility) };
  if (!values.name.trim()) errors.name = "Este campo es obligatorio.";
  if (!values.key) errors.key = "Este campo es obligatorio.";
  else if (!isValidKey(values.key)) errors.key = "Minúsculas y números, separados por guion o guion bajo (ej. 10k).";
  if (values.distance_km.trim() !== "" && kmToMeters(values.distance_km) === null) errors.distance_km = "Kilómetros, hasta 3 decimales (ej. 10 o 5.5).";
  if (values.sort_order.trim() !== "" && !/^\d{1,5}$/.test(values.sort_order.trim())) errors.sort_order = "Número entero, 0 o mayor.";
  if (mode === "create" && values.effective_capacity.trim() !== "" && parseOptionalCount(values.effective_capacity) === undefined) {
    errors.effective_capacity = "Número entero, 0 o mayor.";
  }
  return errors;
}

export function buildModalityBody(values: ModalityFormValues, mode: "create" | "edit"): JsonObject {
  const body: JsonObject = {
    key: values.key,
    name: values.name.trim(),
    generates_distance_credit: values.generates_distance_credit,
    eligibility_rules: buildEligibility(values.eligibility),
  };
  const meters = kmToMeters(values.distance_km);
  if (meters !== null) body.official_distance_m = meters;
  if (values.local_start_time) body.local_start_time = values.local_start_time;
  if (values.sort_order.trim() !== "") body.sort_order = Number(values.sort_order);
  if (mode === "create") {
    const capacity = parseOptionalCount(values.effective_capacity);
    if (typeof capacity === "number") body.effective_capacity = capacity;
  }
  return body;
}

export type PriceFormValues = { name: string; amount: string; starts_at: string; ends_at: string; status: "ACTIVE" | "INACTIVE" };

export function validatePriceValues(values: PriceFormValues, timeZone: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = "Este campo es obligatorio.";
  if (parseMoneyToMinor(values.amount) === null) errors.amount = "Monto en pesos, con hasta 2 decimales (0 = gratuita).";
  const start = values.starts_at ? zonedLocalToIso(values.starts_at, timeZone) : null;
  const end = values.ends_at ? zonedLocalToIso(values.ends_at, timeZone) : null;
  if (values.starts_at && !start) errors.starts_at = "Fecha y hora no válidas.";
  if (values.ends_at && !end) errors.ends_at = "Fecha y hora no válidas.";
  if (start && end && new Date(end).getTime() <= new Date(start).getTime()) errors.ends_at = "El fin debe ser posterior al inicio.";
  return errors;
}

export function buildPriceBody(values: PriceFormValues, timeZone: string, mode: "create" | "edit"): JsonObject {
  const body: JsonObject = {
    name: values.name.trim(),
    amount_minor: parseMoneyToMinor(values.amount) ?? 0,
    status: values.status,
  };
  const start = values.starts_at ? zonedLocalToIso(values.starts_at, timeZone) : null;
  const end = values.ends_at ? zonedLocalToIso(values.ends_at, timeZone) : null;
  if (mode === "create") {
    body.currency = "MXN";
    if (start) body.starts_at = start;
    if (end) body.ends_at = end;
  } else {
    body.starts_at = start;
    body.ends_at = end;
  }
  return body;
}
