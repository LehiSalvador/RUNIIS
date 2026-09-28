import { E164_PATTERN, GUEST_MIN_AGE, ADULT_AGE } from "@/lib/shared/people";

/**
 * Client mirror of the seven identity/contact fields shared by onboarding (Master §16) and
 * GuestParticipant (§24). The server re-validates everything; this only gives immediate, field-level
 * feedback. Ages are computed on the America/Monterrey calendar, like the DB commands.
 */
export type PersonFields = {
  full_name: string;
  date_of_birth: string | null;
  sex_code: "" | "F" | "M" | "X";
  phone_e164: string;
  emergency_contact_name: string;
  emergency_contact_phone_e164: string;
  emergency_contact_relationship: string;
};

export type PersonField = keyof PersonFields;

export const PERSON_FIELD_ORDER: readonly PersonField[] = [
  "full_name",
  "date_of_birth",
  "sex_code",
  "phone_e164",
  "emergency_contact_name",
  "emergency_contact_phone_e164",
  "emergency_contact_relationship",
];

export const SEX_OPTIONS = [
  { value: "F", label: "Mujer" },
  { value: "M", label: "Hombre" },
  { value: "X", label: "No binario" },
] as const;

export const RELATIONSHIP_SUGGESTIONS = ["Madre", "Padre", "Pareja", "Hermana o hermano", "Hija o hijo", "Amistad", "Otro familiar"] as const;

const BUSINESS_TIMEZONE = "America/Monterrey";

export function todayInBusinessZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole years between an ISO birth date and an ISO "today". */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export type AgeBand = "UNDER_MIN" | "MINOR" | "ADULT";

export function ageBand(age: number): AgeBand {
  if (age < GUEST_MIN_AGE) return "UNDER_MIN";
  return age < ADULT_AGE ? "MINOR" : "ADULT";
}

/**
 * Accepts what people actually type ("81 1234 5678", "+52 (81) 1234-5678"). A bare 10-digit number
 * is a Mexican number (+52); anything else must already carry its country code.
 */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s().-]/g, "");
  let candidate = compact;
  if (/^\d{10}$/.test(compact)) candidate = `+52${compact}`;
  else if (/^52\d{10}$/.test(compact)) candidate = `+${compact}`;
  return E164_PATTERN.test(candidate) ? candidate : null;
}

/** "+528112345678" -> "+52 81 1234 5678"; other countries stay as stored. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const mx = /^\+52(\d{2})(\d{4})(\d{4})$/.exec(e164);
  return mx ? `+52 ${mx[1]} ${mx[2]} ${mx[3]}` : e164;
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

export const FIELD_MESSAGES: Record<PersonField, string> = {
  full_name: "Escribe el nombre completo (al menos 2 caracteres).",
  date_of_birth: "Escribe una fecha válida con formato dd/mm/aaaa.",
  sex_code: "Elige una opción.",
  phone_e164: "Escribe un teléfono válido de 10 dígitos o con lada internacional (+).",
  emergency_contact_name: "Escribe el nombre del contacto de emergencia.",
  emergency_contact_phone_e164: "Escribe un teléfono válido de 10 dígitos o con lada internacional (+).",
  emergency_contact_relationship: "Indica la relación con el contacto.",
};

export const UNDER_MIN_AGE_MESSAGE = "La persona debe tener al menos 15 años.";

export function validatePersonFields(values: PersonFields, today: string = todayInBusinessZone()): Map<PersonField, string> {
  const errors = new Map<PersonField, string>();
  const name = collapse(values.full_name);
  if (name.length < 2 || name.length > 120) errors.set("full_name", FIELD_MESSAGES.full_name);
  if (!values.date_of_birth || values.date_of_birth > today || ageOn(values.date_of_birth, today) > 120) {
    errors.set("date_of_birth", FIELD_MESSAGES.date_of_birth);
  } else if (ageBand(ageOn(values.date_of_birth, today)) === "UNDER_MIN") {
    errors.set("date_of_birth", UNDER_MIN_AGE_MESSAGE);
  }
  if (!values.sex_code) errors.set("sex_code", FIELD_MESSAGES.sex_code);
  if (!normalizePhone(values.phone_e164)) errors.set("phone_e164", FIELD_MESSAGES.phone_e164);
  const contact = collapse(values.emergency_contact_name);
  if (contact.length < 2 || contact.length > 120) errors.set("emergency_contact_name", FIELD_MESSAGES.emergency_contact_name);
  if (!normalizePhone(values.emergency_contact_phone_e164)) errors.set("emergency_contact_phone_e164", FIELD_MESSAGES.emergency_contact_phone_e164);
  const relationship = collapse(values.emergency_contact_relationship);
  if (relationship.length < 1 || relationship.length > 60) errors.set("emergency_contact_relationship", FIELD_MESSAGES.emergency_contact_relationship);
  return errors;
}

/** Body for POST /me/onboarding and /me/guests (all seven fields, phones already E.164). */
export function toPersonPayload(values: PersonFields) {
  return {
    full_name: collapse(values.full_name),
    date_of_birth: values.date_of_birth ?? "",
    sex_code: values.sex_code,
    phone_e164: normalizePhone(values.phone_e164) ?? values.phone_e164,
    emergency_contact_name: collapse(values.emergency_contact_name),
    emergency_contact_phone_e164: normalizePhone(values.emergency_contact_phone_e164) ?? values.emergency_contact_phone_e164,
    emergency_contact_relationship: collapse(values.emergency_contact_relationship),
  };
}
