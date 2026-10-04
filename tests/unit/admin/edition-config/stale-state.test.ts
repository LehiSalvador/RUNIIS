import { describe, expect, test } from "vitest";
import {
  changedEditionFieldLabels,
  describeRefusal,
  editionToFormValues,
  humanField,
  isStaleState,
  rebaseEditionValues,
  type EditionLike,
} from "@/components/admin/events/form-logic";

const edition: EditionLike = {
  name: "Carrera Aniversario 2026",
  slug: "carrera-aniversario-2026",
  registration_mode: "EXTERNAL_WHATSAPP",
  timezone: "America/Monterrey",
  city: "Monterrey",
  state_region: "Nuevo León",
  country_code: "MX",
  registration_open_at: null,
  registration_close_at: "2026-11-01T11:00:00.000000+00:00",
  global_capacity: 400,
  whatsapp_phone_e164: "+528110814941",
  is_benefit_event: false,
  schedule: { local_date: "2026-11-15", local_start_time: "06:30:00", local_end_time: null },
};

const stale = {
  code: "CONFLICT" as const,
  requestId: "req-1",
  details: { reason: "STALE_STATE", field: "expected_updated_at", current_updated_at: "2026-10-03T12:00:01.000001+00:00" },
};

describe("stale state (P3-L optimistic concurrency)", () => {
  test("only the 409 whose reason is STALE_STATE is a stale refusal; other conflicts keep their own meaning", () => {
    expect(isStaleState(stale)).toBe(true);
    expect(isStaleState({ code: "CONFLICT", details: { reason: "taken", field: "slug" } })).toBe(false);
    expect(isStaleState({ code: "CONFLICT", details: { reason: "invalid_transition" } })).toBe(false);
    expect(isStaleState({ code: "VALIDATION_ERROR", details: { reason: "STALE_STATE" } })).toBe(false);
    expect(isStaleState({ code: "CONFLICT", details: {} })).toBe(false);
  });

  test("a stale refusal is explained as such: nothing was applied, the page was refreshed, review and retry; the request id stays", () => {
    const refusal = describeRefusal(stale);
    expect(refusal.stale).toBe(true);
    expect(refusal.view.kind).toBe("stale");
    expect(refusal.view.title).toBe("La edición cambió mientras la editabas");
    expect(refusal.view.message).toContain("No se aplicó nada");
    expect(refusal.view.action).toBe("reload");
    expect(refusal.view.requestId).toBe("req-1");
    // never the raw reason code or the server timestamp
    expect(JSON.stringify(refusal)).not.toContain("STALE_STATE");
    expect(JSON.stringify(refusal)).not.toContain("2026-10-03T12:00:01");
    expect(refusal.reasons).toEqual([]);
  });

  test("an ordinary conflict is not reported as stale", () => {
    const refusal = describeRefusal({ code: "CONFLICT", requestId: "r", details: { reason: "taken", field: "slug" } });
    expect(refusal.stale).toBe(false);
    expect(refusal.view.title).toBe("Ya existe");
  });
});

describe("rebasing an open form onto the refetched Edition", () => {
  const before = editionToFormValues(edition);

  test("lists what someone else changed, in the operator's words", () => {
    const after = editionToFormValues({ ...edition, name: "Carrera 2026", whatsapp_phone_e164: "+528181234567" });
    expect(changedEditionFieldLabels(before, after)).toEqual(["Nombre", "WhatsApp de la edición"]);
    expect(changedEditionFieldLabels(before, before)).toEqual([]);
  });

  test("a field the operator did not touch takes the fresh value; one they edited keeps their text", () => {
    const fresh = editionToFormValues({ ...edition, name: "Carrera 2026", city: "San Pedro" });
    const typing = { ...before, city: "Guadalupe" };
    const merged = rebaseEditionValues(before, fresh, typing);
    expect(merged.name).toBe("Carrera 2026");
    expect(merged.city).toBe("Guadalupe");
    expect(merged.slug).toBe(before.slug);
  });

  test("with nothing typed the form simply becomes the fresh Edition; with nothing changed it keeps what was typed", () => {
    const fresh = editionToFormValues({ ...edition, global_capacity: 450 });
    expect(rebaseEditionValues(before, fresh, before)).toEqual(fresh);
    const typing = { ...before, name: "Otro nombre" };
    expect(rebaseEditionValues(before, before, typing)).toEqual(typing);
  });
});

describe("naming the server's field paths", () => {
  test("indexed paths read as a row of the editor", () => {
    expect(humanField("fields[2].label")).toBe("Campo 3 · Etiqueta");
    expect(humanField("fields[0].options_config.options[1].value")).toContain("Campo 1");
    expect(humanField("payload.items[0].question")).toBe("Elemento 1 · question");
    expect(humanField("payload.title")).toBe("Título");
    expect(humanField("latitude")).toBe("Latitud");
    expect(humanField("something_unknown")).toBe("something_unknown");
  });

  test("the reasons of the configuration commands are in plain language", () => {
    const duplicate = describeRefusal({ code: "VALIDATION_ERROR", requestId: null, details: { field: "fields", reason: "duplicate_field_key" } });
    expect(duplicate.reasons[0]).toContain("misma clave");
    const draft = describeRefusal({ code: "CONFLICT", requestId: null, details: { reason: "draft_exists" } });
    expect(draft.reasons[0]).toContain("borrador");
    const html = describeRefusal({ code: "VALIDATION_ERROR", requestId: null, details: { field: "payload.markdown", reason: "html_not_allowed" } });
    expect(html.reasons[0]).toContain("no admite HTML");
    const inUse = describeRefusal({ code: "CONFLICT", requestId: null, details: { reason: "in_use" } });
    expect(inUse.reasons[0]).toContain("Ya se usa");
    expect(inUse.view.title).toBe("Todavía se usa");
    expect(inUse.view.message).not.toContain("Alguien más");
    expect(draft.view.title).toBe("Ya hay un borrador");
  });
});
