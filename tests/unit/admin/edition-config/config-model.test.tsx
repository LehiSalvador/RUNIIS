import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ConfigSummary } from "@/components/admin/edition-config/config-summary";
import { FormsManager } from "@/components/admin/edition-config/forms-manager";
import { LegalStatus } from "@/components/admin/edition-config/legal-status";
import { ScheduleRevisionPanel } from "@/components/admin/edition-config/schedule-panel";
import { EditionSubnav } from "@/components/admin/events/edition-subnav";
import { ReadinessChecklist } from "@/components/admin/readiness-checklist";
import {
  CONFIG_SECTIONS,
  buildConfigSummary,
  buildFormScopes,
  readinessFix,
  sectionHref,
  type FormVersion,
} from "@/components/admin/edition-config/config-model";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/eventos/x/formularios",
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
}));

const EDITION = "5a000000-0000-4000-8000-00000000000a";

const field = (key: string, label: string) => ({
  field_key: key,
  label,
  field_type: "TEXT" as const,
  required: true,
  validation_config: { max_length: 40 },
  options_config: {},
  sensitivity: "NORMAL" as const,
  sort_order: 1,
});

const form = (patch: Partial<FormVersion>): FormVersion => ({
  registration_form_id: "f1",
  modality_id: null,
  version: 1,
  status: "PUBLISHED",
  created_at: "2026-10-01T10:00:00+00:00",
  published_at: "2026-10-01T10:05:00+00:00",
  fields: [],
  ...patch,
});

const modalities = [
  { modality_id: "m10", name: "10K", status: "ACTIVE", sort_order: 2 },
  { modality_id: "m5", name: "5K", status: "ACTIVE", sort_order: 1 },
  { modality_id: "mx", name: "Cancelada", status: "CANCELED", sort_order: 3 },
];

describe("where each requirement is resolved", () => {
  test("a failing readiness code opens the section that fixes it", () => {
    expect(readinessFix(EDITION, "FORM_PUBLISHED")).toEqual({ href: `/admin/eventos/${EDITION}/formularios`, label: "Formularios" });
    expect(readinessFix(EDITION, "DESCRIPTION_PRESENT")?.href).toBe(`/admin/eventos/${EDITION}/contenido`);
    expect(readinessFix(EDITION, "WHATSAPP_CONFIGURED")?.href).toBe(`/admin/eventos/${EDITION}/configuracion`);
    expect(readinessFix(EDITION, "MODALITY_PRESENT")?.href).toBe(`/admin/eventos/${EDITION}/modalidades`);
    // no staff screen of the Edition resolves these two
    expect(readinessFix(EDITION, "LEGAL_DOCUMENTS_PUBLISHED")).toBeNull();
    expect(readinessFix(EDITION, "EXECUTION_SCHEDULED")).toBeNull();
  });

  test("every section the catalogue names is a segment of the sub-navigation", () => {
    const html = renderToStaticMarkup(<EditionSubnav editionId={EDITION} current="formularios" />);
    for (const key of Object.keys(CONFIG_SECTIONS) as (keyof typeof CONFIG_SECTIONS)[]) {
      expect(html, key).toContain(`href="${sectionHref(EDITION, key)}"`);
    }
    expect(html).toContain('aria-current="page"');
    for (const label of ["Formularios", "Ubicaciones", "Agenda", "Contenido"]) expect(html).toContain(label);
  });

  test("the readiness checklist links only the pending items that have a fix", () => {
    const html = renderToStaticMarkup(
      <ReadinessChecklist
        title="Inscripciones"
        ready={false}
        checks={[
          { code: "FORM_PUBLISHED", ok: false },
          { code: "LEGAL_DOCUMENTS_PUBLISHED", ok: false },
          { code: "ACTIVE_MODALITY", ok: true },
        ]}
        fixFor={(code) => readinessFix(EDITION, code)}
      />,
    );
    expect(html).toContain("Resolver en Formularios");
    expect(html).toContain(`/admin/eventos/${EDITION}/formularios`);
    expect(html.match(/Resolver en/g)).toHaveLength(1);
    // callers that pass no resolver are unchanged
    expect(renderToStaticMarkup(<ReadinessChecklist title="x" ready={false} checks={[{ code: "FORM_PUBLISHED", ok: false }]} />)).not.toContain("Resolver en");
  });
});

describe("registration forms by scope", () => {
  test("one scope for everyone, then one per modality that is not canceled, ordered; the published, draft and history are told apart", () => {
    const scopes = buildFormScopes(
      [
        form({ registration_form_id: "a1", version: 1, status: "SUPERSEDED" }),
        form({ registration_form_id: "a2", version: 2, status: "PUBLISHED" }),
        form({ registration_form_id: "a3", version: 3, status: "DRAFT", published_at: null }),
        form({ registration_form_id: "b1", modality_id: "m10", version: 1, status: "DRAFT", published_at: null }),
      ],
      modalities,
    );
    expect(scopes.map((scope) => scope.name)).toEqual(["Todas las modalidades", "5K", "10K"]);
    const all = scopes[0];
    expect(all.published?.version).toBe(2);
    expect(all.draft?.version).toBe(3);
    expect(all.history.map((entry) => entry.version)).toEqual([1]);
    const tenK = scopes[2];
    expect(tenK.published).toBeNull();
    expect(tenK.draft?.version).toBe(1);
    expect(scopes[1].published).toBeNull();
    expect(scopes[1].draft).toBeNull();
  });

  test("a canceled modality only appears when it still has versions", () => {
    const withForms = buildFormScopes([form({ modality_id: "mx" })], modalities);
    expect(withForms.map((scope) => scope.key)).toContain("mx");
  });

  const render = (forms: FormVersion[], frozen = false) =>
    renderToStaticMarkup(<FormsManager editionId={EDITION} timezone="America/Monterrey" frozen={frozen} scopes={buildFormScopes(forms, modalities)} />);

  test("a published version is read-only: it offers Edit (which creates a draft), a preview and no field controls", () => {
    const html = render([form({ version: 3, fields: [field("talla", "Talla de playera")] })]);
    expect(html).toContain("Publicado v3");
    expect(html).toContain("Talla de playera");
    expect(html).toContain("Editar (crea un borrador v4)");
    expect(html).toContain("Una versión publicada no se modifica");
    expect(html).toContain("Vista previa");
    expect(html).not.toContain("Agregar pregunta");
    expect(html).not.toContain("Guardar borrador");
  });

  test("a draft is editable, saved before publishing, and says what publishing does to the published version", () => {
    const html = render([
      form({ registration_form_id: "p", version: 3, fields: [field("talla", "Talla")] }),
      form({ registration_form_id: "d", version: 4, status: "DRAFT", published_at: null, fields: [field("talla", "Talla"), field("club", "Club")] }),
    ]);
    expect(html).toContain("Borrador v4");
    expect(html).toContain("basado en v3");
    expect(html).toContain("Agregar pregunta");
    expect(html).toContain("Guardar borrador");
    expect(html).toContain("Publicar v4");
    expect(html).toContain("Eliminar borrador");
    // while a draft exists there is no second "create draft" action on the published version
    expect(html).not.toContain("Editar (crea un borrador");
    expect(html).toContain("Guardado. Publicarlo lo hace visible");
  });

  test("a scope with nothing offers to create the form; a frozen Edition offers nothing", () => {
    const empty = render([]);
    expect(empty).toContain("Crear formulario");
    expect(empty).toContain("Sin versión publicada");
    expect(empty).toContain("Esta modalidad usa el formulario general");
    const frozen = render([], true);
    expect(frozen).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<svg[^>]*>.*?<\/svg>)?Crear formulario/s);
  });

  test("older versions are kept as history, collapsed", () => {
    const html = render([form({ registration_form_id: "p", version: 2 }), form({ registration_form_id: "o", version: 1, status: "SUPERSEDED", fields: [field("viejo", "Pregunta anterior")] })]);
    expect(html).toContain("Versiones anteriores (1)");
    expect(html).toContain("Pregunta anterior");
    expect(html).toContain("reemplazada");
  });
});

describe("configuration summary on the Edition overview", () => {
  const base = { editionId: EDITION, forms: [], locations: 0, agenda: 0, content: [], whatsappRequired: true };

  test("what the server reports missing is shown as pending, with the section to open", () => {
    const items = buildConfigSummary({
      ...base,
      readiness: [
        { code: "FORM_PUBLISHED", ok: false },
        { code: "DESCRIPTION_PRESENT", ok: false },
        { code: "WHATSAPP_CONFIGURED", ok: false },
      ],
    });
    expect(items.map((item) => item.key)).toEqual(["formularios", "ubicaciones", "agenda", "contenido", "configuracion"]);
    expect(items.filter((item) => item.tone === "attention").map((item) => item.key)).toEqual(["formularios", "contenido", "configuracion"]);
    expect(items.find((item) => item.key === "formularios")?.pending).toContain("formulario publicado");
    expect(items.find((item) => item.key === "ubicaciones")?.tone).toBe("info");
  });

  test("a configured Edition shows what exists and nothing pending", () => {
    const items = buildConfigSummary({
      ...base,
      forms: [{ status: "PUBLISHED" }, { status: "DRAFT" }, { status: "SUPERSEDED" }],
      locations: 2,
      agenda: 1,
      content: [{ status: "PUBLISHED" }, { status: "DRAFT" }],
      readiness: [{ code: "FORM_PUBLISHED", ok: true }, { code: "DESCRIPTION_PRESENT", ok: true }, { code: "WHATSAPP_CONFIGURED", ok: true }],
    });
    expect(items.every((item) => item.pending === null)).toBe(true);
    expect(items.find((item) => item.key === "formularios")?.value).toBe("1 versión publicada · 1 borrador");
    expect(items.find((item) => item.key === "ubicaciones")?.value).toBe("2 ubicaciones");
    expect(items.find((item) => item.key === "agenda")?.value).toBe("1 entrada");
    expect(items.find((item) => item.key === "contenido")?.value).toBe("2 bloques · 1 publicados");
    expect(items.find((item) => item.key === "configuracion")?.value).toBe("WhatsApp configurado");
  });

  test("a free Edition has no WhatsApp requirement", () => {
    const items = buildConfigSummary({ ...base, whatsappRequired: false, readiness: [] });
    expect(items.find((item) => item.key === "configuracion")?.value).toBe("Inscripción gratuita: sin WhatsApp");
  });

  test("the panel links every section and reads state by text, not by colour alone", () => {
    const html = renderToStaticMarkup(<ConfigSummary items={buildConfigSummary({ ...base, readiness: [{ code: "FORM_PUBLISHED", ok: false }] })} />);
    expect(html).toContain(`href="/admin/eventos/${EDITION}/formularios"`);
    expect(html).toContain("Requiere atención: ");
    expect(html).toContain("Falta un formulario publicado");
  });
});

describe("calendar revision panel", () => {
  const schedule = {
    revision: 3,
    schedule_state: "DATE_TIME_CONFIRMED",
    local_date: "2026-11-15",
    local_start_time: "06:30:00",
    local_end_time: null,
    timezone: "America/Monterrey",
    effective_start_at: "2026-11-15T12:30:00+00:00",
    effective_end_at: null,
    created_at: "2026-10-03T15:00:00+00:00",
  };

  test("shows the revision in force, in the Edition's zone, and how many came before", () => {
    const html = renderToStaticMarkup(<ScheduleRevisionPanel schedule={schedule} timezone="America/Monterrey" executionState="SCHEDULED" />);
    expect(html).toContain("Revisión 3");
    expect(html).toContain("Antes de esta hubo 2 revisiones del calendario.");
    expect(html).toContain("06:30");
    expect(html).toContain("Fecha y hora confirmadas");
    expect(html).toContain("Aplazar carrera");
    // the effective start is rendered in the zone (12:30 UTC = 06:30 in Monterrey), never the viewer's
    expect(html).toContain("06:30");
  });

  test("is honest about the history it cannot read", () => {
    const html = renderToStaticMarkup(<ScheduleRevisionPanel schedule={schedule} timezone="America/Monterrey" executionState="SCHEDULED" />);
    expect(html).toContain("todavía no se puede consultar");
    const original = renderToStaticMarkup(<ScheduleRevisionPanel schedule={{ ...schedule, revision: 1 }} timezone="America/Monterrey" executionState="SCHEDULED" />);
    expect(original).toContain("calendario original");
    expect(original).not.toContain("todavía no se puede consultar");
  });

  test("a postponed race is rescheduled, and a finished one no longer moves", () => {
    const postponed = renderToStaticMarkup(
      <ScheduleRevisionPanel schedule={{ ...schedule, schedule_state: "POSTPONED_NO_NEW_DATE", local_date: null, local_start_time: null }} timezone="America/Monterrey" executionState="POSTPONED" />,
    );
    expect(postponed).toContain("Aplazada, sin nueva fecha");
    expect(postponed).toContain("Sin fecha");
    expect(postponed).toContain("Reprogramar fecha");
    expect(postponed).not.toContain("Aplazar carrera");
    expect(renderToStaticMarkup(<ScheduleRevisionPanel schedule={schedule} timezone="America/Monterrey" executionState="FINISHED" />)).toContain("ya no se mueve");
    expect(renderToStaticMarkup(<ScheduleRevisionPanel schedule={null} timezone="America/Monterrey" executionState="SCHEDULED" />)).toContain("todavía no tiene calendario");
  });
});

describe("legal documents status", () => {
  const published = (type: string, version = 1) => ({ document_key: type, document_type: type, status: "ACTIVE", edition_id: null, current_version: { version, published_at: "2026-09-01T10:00:00+00:00" } });

  test("lists what is published and what is missing, by text", () => {
    const html = renderToStaticMarkup(
      <LegalStatus editionId={EDITION} timezone="America/Monterrey" documents={[published("TERMS_OF_SERVICE"), published("PRIVACY_NOTICE", 2), { ...published("SPORT_WAIVER"), current_version: null }]} />,
    );
    expect(html).toContain("Publicado: ");
    expect(html).toContain("Sin publicar: ");
    expect(html).toContain("v2");
    expect(html).toMatch(/data-legal-type="SPORT_WAIVER"[\s\S]*Sin versión publicada/);
    expect(html).toContain("todavía no tiene pantalla");
  });

  test("an Edition's own rules document is listed only for that Edition", () => {
    const rules = { document_key: "EVENT_RULES_X", document_type: "EVENT_RULES", status: "ACTIVE", edition_id: EDITION, current_version: { version: 1, published_at: null } };
    expect(renderToStaticMarkup(<LegalStatus editionId={EDITION} timezone="America/Monterrey" documents={[rules]} />)).toContain("Reglamento de esta edición");
    expect(renderToStaticMarkup(<LegalStatus editionId="other" timezone="America/Monterrey" documents={[rules]} />)).not.toContain("Reglamento de esta edición");
  });
});
