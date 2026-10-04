import type { ServerFormField } from "@/components/admin/edition-config/form-field-logic";

/**
 * Pure helpers shared by the Edition configuration screens (P3-E2): the section catalogue, where each readiness requirement is
 * resolved, how registration forms group by scope, and the completeness summary on the Edition overview. The SERVER decides
 * readiness; nothing here recomputes it, it only points the operator at the screen that fixes a failing check.
 */

export type ConfigSectionKey = "configuracion" | "modalidades" | "formularios" | "ubicaciones" | "agenda" | "contenido";

export const CONFIG_SECTIONS: Readonly<Record<ConfigSectionKey, { label: string; segment: string; description: string }>> = {
  configuracion: { label: "Datos y fechas", segment: "configuracion", description: "Nombre, sede, fechas clave, zona horaria, WhatsApp e inscripción." },
  modalidades: { label: "Modalidades y precios", segment: "modalidades", description: "Modalidades, precios, capacidad y categorías." },
  formularios: { label: "Formularios", segment: "formularios", description: "Preguntas extra de la inscripción, versiones y vista previa." },
  ubicaciones: { label: "Ubicaciones", segment: "ubicaciones", description: "Sede, salida, meta, entrega de kits y estacionamiento." },
  agenda: { label: "Agenda", segment: "agenda", description: "Programa del evento por día y hora." },
  contenido: { label: "Contenido", segment: "contenido", description: "Descripción, avisos, preguntas frecuentes, enlaces y patrocinadores." },
};

export function sectionHref(editionId: string, key: ConfigSectionKey): string {
  return `/admin/eventos/${editionId}/${CONFIG_SECTIONS[key].segment}`;
}

const FIX_SECTION: Record<string, ConfigSectionKey> = {
  SLUG_VALID: "configuracion",
  TIMEZONE_VALID: "configuracion",
  CITY_PRESENT: "configuracion",
  DATE_KNOWN: "configuracion",
  SCHEDULE_DATE_VALID: "configuracion",
  REGISTRATION_OPEN_AT_REACHED: "configuracion",
  REGISTRATION_CLOSE_AT_FUTURE: "configuracion",
  WHATSAPP_CONFIGURED: "configuracion",
  MODALITY_PRESENT: "modalidades",
  ACTIVE_MODALITY: "modalidades",
  OFFICIAL_DISTANCE_FOR_CREDIT: "modalidades",
  CAPACITY_VALID: "modalidades",
  PRICE_VALID: "modalidades",
  ELIGIBILITY_RULES_VALID: "modalidades",
  FORM_PUBLISHED: "formularios",
  DESCRIPTION_PRESENT: "contenido",
};

/** Where a failing readiness check is resolved, or null when no staff screen of the Edition does it (execution state, legal documents). */
export function readinessFix(editionId: string, code: string): { href: string; label: string } | null {
  const key = FIX_SECTION[code];
  return key ? { href: sectionHref(editionId, key), label: CONFIG_SECTIONS[key].label } : null;
}

// ---------------------------------------------------------------------------------------------
// Registration forms by scope
// ---------------------------------------------------------------------------------------------

export type FormVersion = {
  registration_form_id: string;
  modality_id: string | null;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  created_at: string;
  published_at: string | null;
  fields: (ServerFormField & { registration_form_field_id?: string; sort_order?: number })[];
};

export type FormScope = {
  /** "edition" or the modality id. */
  key: string;
  modalityId: string | null;
  name: string;
  modalityStatus: string | null;
  published: FormVersion | null;
  draft: FormVersion | null;
  history: FormVersion[];
};

type ModalityLike = { modality_id: string; name: string; status: string; sort_order: number };

/**
 * One scope per audience: the edition-wide form (everyone) and one per modality that is not canceled (or that already has versions).
 * Within a scope the PUBLISHED version is what participants fill in, the DRAFT is the only editable one, and SUPERSEDED versions are history.
 */
export function buildFormScopes(forms: readonly FormVersion[], modalities: readonly ModalityLike[]): FormScope[] {
  const scopeOf = (modalityId: string | null, name: string, status: string | null): FormScope => {
    const versions = forms.filter((form) => form.modality_id === modalityId).sort((a, b) => b.version - a.version);
    return {
      key: modalityId ?? "edition",
      modalityId,
      name,
      modalityStatus: status,
      published: versions.find((form) => form.status === "PUBLISHED") ?? null,
      draft: versions.find((form) => form.status === "DRAFT") ?? null,
      history: versions.filter((form) => form.status === "SUPERSEDED"),
    };
  };
  const scopes = [scopeOf(null, "Todas las modalidades", null)];
  for (const modality of [...modalities].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "es"))) {
    const scope = scopeOf(modality.modality_id, modality.name, modality.status);
    if (modality.status !== "CANCELED" || scope.published || scope.draft || scope.history.length > 0) scopes.push(scope);
  }
  return scopes;
}

// ---------------------------------------------------------------------------------------------
// Completeness summary (Edition overview)
// ---------------------------------------------------------------------------------------------

export type SummaryItem = {
  key: ConfigSectionKey;
  label: string;
  href: string;
  /** What exists, in words. */
  value: string;
  tone: "ok" | "attention" | "info";
  /** The readiness requirement this section is responsible for, when the server reports one failing. */
  pending: string | null;
};

type Check = { code: string; ok: boolean };

export function buildConfigSummary(input: {
  editionId: string;
  forms: readonly Pick<FormVersion, "status">[];
  locations: number;
  agenda: number;
  content: readonly { status: string }[];
  readiness: readonly Check[];
  whatsappRequired: boolean;
}): SummaryItem[] {
  const failing = new Set(input.readiness.filter((check) => !check.ok).map((check) => check.code));
  const published = input.forms.filter((form) => form.status === "PUBLISHED").length;
  const drafts = input.forms.filter((form) => form.status === "DRAFT").length;
  const publishedBlocks = input.content.filter((block) => block.status === "PUBLISHED").length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const item = (key: ConfigSectionKey, value: string, tone: SummaryItem["tone"], pending: string | null): SummaryItem => ({
    key,
    label: CONFIG_SECTIONS[key].label,
    href: sectionHref(input.editionId, key),
    value,
    tone,
    pending,
  });

  return [
    item(
      "formularios",
      `${plural(published, "versión publicada", "versiones publicadas")}${drafts > 0 ? ` · ${plural(drafts, "borrador", "borradores")}` : ""}`,
      failing.has("FORM_PUBLISHED") ? "attention" : "ok",
      failing.has("FORM_PUBLISHED") ? "Falta un formulario publicado para abrir inscripciones." : null,
    ),
    item("ubicaciones", plural(input.locations, "ubicación", "ubicaciones"), input.locations > 0 ? "ok" : "info", null),
    item("agenda", plural(input.agenda, "entrada", "entradas"), input.agenda > 0 ? "ok" : "info", null),
    item(
      "contenido",
      `${plural(input.content.length, "bloque", "bloques")} · ${publishedBlocks} publicados`,
      failing.has("DESCRIPTION_PRESENT") ? "attention" : "ok",
      failing.has("DESCRIPTION_PRESENT") ? "Falta una descripción publicada para publicar la edición." : null,
    ),
    item(
      "configuracion",
      input.whatsappRequired ? (failing.has("WHATSAPP_CONFIGURED") ? "Sin WhatsApp configurado" : "WhatsApp configurado") : "Inscripción gratuita: sin WhatsApp",
      failing.has("WHATSAPP_CONFIGURED") ? "attention" : "ok",
      failing.has("WHATSAPP_CONFIGURED") ? "Falta el número de WhatsApp para abrir inscripciones." : null,
    ),
  ];
}
