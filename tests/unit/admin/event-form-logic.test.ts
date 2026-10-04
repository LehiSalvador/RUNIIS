import { describe, expect, test } from "vitest";
import {
  buildCreateEditionBody,
  buildEditionChanges,
  buildEligibility,
  buildModalityBody,
  buildPriceBody,
  describeEligibility,
  describeRefusal,
  editionToFormValues,
  emptyEditionValues,
  emptyModalityValues,
  formatMoney,
  isoToZonedLocal,
  isValidE164,
  isValidKey,
  isValidSlug,
  keyify,
  kmToMeters,
  metersToKmInput,
  minorToInput,
  parseMoneyToMinor,
  parseOptionalCount,
  sameEditionValues,
  slugify,
  validateEditionValues,
  validateEligibility,
  validateModalityValues,
  validatePriceValues,
  zonedLocalToIso,
  type EditionFormValues,
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
  registration_open_at: "2026-10-01T15:00:00+00:00",
  registration_close_at: "2026-11-14T11:30:00+00:00",
  global_capacity: 500,
  whatsapp_phone_e164: "+528110814941",
  is_benefit_event: false,
  schedule: { local_date: "2026-11-15", local_start_time: "06:30:00", local_end_time: null },
};

describe("dates in the Edition timezone", () => {
  test("a Monterrey wall-clock reading becomes an instant with the zone's offset", () => {
    expect(zonedLocalToIso("2026-11-15T06:30", "America/Monterrey")).toBe("2026-11-15T06:30:00-06:00");
    // Tijuana observes daylight saving in July, Monterrey does not
    expect(zonedLocalToIso("2026-07-15T06:30", "America/Tijuana")).toBe("2026-07-15T06:30:00-07:00");
    expect(zonedLocalToIso("2026-07-15T06:30", "America/Monterrey")).toBe("2026-07-15T06:30:00-06:00");
  });

  test("the instant round-trips to the same reading, whatever the viewer's own zone", () => {
    const iso = zonedLocalToIso("2026-11-14T05:30", "America/Monterrey");
    expect(iso).not.toBeNull();
    expect(isoToZonedLocal(iso, "America/Monterrey")).toBe("2026-11-14T05:30");
    expect(isoToZonedLocal("2026-11-14T11:30:00+00:00", "America/Monterrey")).toBe("2026-11-14T05:30");
  });

  test("impossible dates, bad text and unknown zones are refused instead of guessed", () => {
    expect(zonedLocalToIso("2026-02-31T10:00", "America/Monterrey")).toBeNull();
    expect(zonedLocalToIso("2026-02-10 10:00", "America/Monterrey")).toBeNull();
    expect(zonedLocalToIso("2026-02-10T10:00", "Mars/Olympus")).toBeNull();
    expect(isoToZonedLocal("not-a-date", "America/Monterrey")).toBe("");
    expect(isoToZonedLocal(null, "America/Monterrey")).toBe("");
  });
});

describe("text and money helpers", () => {
  test("slugs follow the server rule (lowercase ASCII, hyphens, 3-120)", () => {
    expect(slugify("Carrera Atlética 5K · Aniversario")).toBe("carrera-atletica-5k-aniversario");
    expect(slugify("  --Ñandú  Run!!  ")).toBe("nandu-run");
    expect(slugify("x".repeat(200)).length).toBe(120);
    expect(isValidSlug("carrera-5k-2026")).toBe(true);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("Carrera 5K")).toBe(false);
    expect(isValidSlug("carrera--5k")).toBe(false);
  });

  test("modality keys allow hyphen or underscore separators only", () => {
    expect(keyify("10 K Varonil")).toBe("10-k-varonil");
    expect(isValidKey("10k")).toBe(true);
    expect(isValidKey("kids_5k")).toBe(true);
    expect(isValidKey("10K")).toBe(false);
    expect(isValidKey("a__b")).toBe(false);
  });

  test("E.164 numbers need the plus and 7-15 digits", () => {
    expect(isValidE164("+528110814941")).toBe(true);
    expect(isValidE164("8110814941")).toBe(false);
    expect(isValidE164("+52 811 081 4941")).toBe(false);
  });

  test("money is typed in pesos and travels in minor units; zero is explicitly free", () => {
    expect(parseMoneyToMinor("350")).toBe(35000);
    expect(parseMoneyToMinor("$1,250.50")).toBe(125050);
    expect(parseMoneyToMinor("0")).toBe(0);
    expect(parseMoneyToMinor("12.345")).toBeNull();
    expect(parseMoneyToMinor("-5")).toBeNull();
    expect(parseMoneyToMinor("abc")).toBeNull();
    expect(parseMoneyToMinor("9999999999")).toBeNull();
    expect(minorToInput(35050)).toBe("350.50");
    expect(formatMoney(0)).toBe("Gratis");
    expect(formatMoney(35000)).toMatch(/350\.00/);
    expect(formatMoney(35000)).toMatch(/\$/);
  });

  test("distance converts between km (typed) and metres (stored)", () => {
    expect(kmToMeters("10")).toBe(10000);
    expect(kmToMeters("5,5")).toBe(5500);
    expect(kmToMeters("0")).toBeNull();
    expect(kmToMeters("abc")).toBeNull();
    expect(metersToKmInput(21097)).toBe("21.097");
    expect(metersToKmInput(null)).toBe("");
  });

  test("optional counts: empty is no limit, otherwise a non-negative integer", () => {
    expect(parseOptionalCount("")).toBeNull();
    expect(parseOptionalCount(" 250 ")).toBe(250);
    expect(parseOptionalCount("0")).toBe(0);
    expect(parseOptionalCount("-1")).toBeUndefined();
    expect(parseOptionalCount("2.5")).toBeUndefined();
    expect(parseOptionalCount("2000000")).toBeUndefined();
  });
});

describe("edition form: validation", () => {
  const valid = (): EditionFormValues => ({
    ...emptyEditionValues(),
    name: "Carrera Aniversario 2026",
    slug: "carrera-aniversario-2026",
    city: "Monterrey",
    state_region: "Nuevo León",
    local_date: "2026-11-15",
  });

  test("a complete form passes; the server keeps the business rules", () => {
    expect(validateEditionValues(valid(), "create")).toEqual({});
  });

  test("required fields and formats are flagged by field name", () => {
    const errors = validateEditionValues({ ...emptyEditionValues(), whatsapp_phone_e164: "123", global_capacity: "-4", slug: "A B" }, "create");
    expect(Object.keys(errors).sort()).toEqual(["city", "global_capacity", "name", "registration_close_at", "slug", "state_region", "whatsapp_phone_e164"]);
  });

  test("a create without a race date needs an explicit registration close", () => {
    const values = { ...valid(), local_date: "" };
    expect(validateEditionValues(values, "create").registration_close_at).toBeDefined();
    expect(validateEditionValues({ ...values, registration_close_at: "2026-11-10T20:00" }, "create").registration_close_at).toBeUndefined();
    // editing keeps the stored close, so the rule only applies on create
    expect(validateEditionValues(values, "edit").registration_close_at).toBeUndefined();
  });

  test("times need a date and must be ordered; the opening must precede the close", () => {
    expect(validateEditionValues({ ...valid(), local_date: "", local_start_time: "06:00", registration_close_at: "2026-11-01T10:00" }, "create").local_date).toBeDefined();
    expect(validateEditionValues({ ...valid(), local_start_time: "08:00", local_end_time: "07:00" }, "create").local_end_time).toBeDefined();
    expect(validateEditionValues({ ...valid(), local_end_time: "09:00" }, "create").local_end_time).toBeDefined();
    const window = validateEditionValues({ ...valid(), registration_open_at: "2026-11-10T10:00", registration_close_at: "2026-11-09T10:00" }, "create");
    expect(window.registration_open_at).toBeDefined();
  });
});

describe("edition form: request bodies", () => {
  test("create sends only what was filled, with offsets in the Edition zone, and a schedule block", () => {
    const body = buildCreateEditionBody({
      ...emptyEditionValues(),
      name: " Carrera 5K ",
      slug: "carrera-5k",
      city: "Monterrey",
      state_region: "Nuevo León",
      local_date: "2026-11-15",
      local_start_time: "06:30",
      registration_close_at: "2026-11-14T20:00",
      global_capacity: "300",
      whatsapp_phone_e164: "+528110814941",
    });
    expect(body).toEqual({
      slug: "carrera-5k",
      name: "Carrera 5K",
      registration_mode: "EXTERNAL_WHATSAPP",
      timezone: "America/Monterrey",
      city: "Monterrey",
      state_region: "Nuevo León",
      country_code: "MX",
      is_benefit_event: false,
      registration_close_at: "2026-11-14T20:00:00-06:00",
      global_capacity: 300,
      whatsapp_phone_e164: "+528110814941",
      schedule: { local_date: "2026-11-15", local_start_time: "06:30" },
    });
    expect(body).not.toHaveProperty("registration_open_at");
  });

  test("the form of a saved edition reads back in the Edition zone", () => {
    const values = editionToFormValues(edition);
    expect(values.registration_open_at).toBe("2026-10-01T09:00");
    expect(values.registration_close_at).toBe("2026-11-14T05:30");
    expect(values.local_start_time).toBe("06:30");
    expect(values.global_capacity).toBe("500");
    expect(sameEditionValues(values, editionToFormValues(edition))).toBe(true);
  });

  test("an unchanged form produces no request at all", () => {
    const values = editionToFormValues(edition);
    expect(buildEditionChanges(values, values, true)).toEqual({ patch: null, schedule: null, labels: [] });
  });

  test("only changed fields travel, and a time-only change goes to the schedule endpoint", () => {
    const baseline = editionToFormValues(edition);
    const changed = { ...baseline, name: "Carrera Aniversario 2026 (Nueva sede)", city: "San Pedro", local_start_time: "07:00" };
    const result = buildEditionChanges(baseline, changed, true);
    expect(result.patch).toEqual({ name: "Carrera Aniversario 2026 (Nueva sede)", city: "San Pedro" });
    expect(result.schedule).toEqual({ local_date: "2026-11-15", local_start_time: "07:00" });
    expect(result.labels).toEqual(["Nombre", "Ciudad", "Fecha y hora de la carrera"]);
  });

  test("an operator never sends the registration mode or window, even if the form was edited", () => {
    const baseline = editionToFormValues(edition);
    const changed = { ...baseline, registration_mode: "FREE" as const, registration_close_at: "2026-11-13T10:00", registration_open_at: "", city: "Apodaca" };
    expect(buildEditionChanges(baseline, changed, false).patch).toEqual({ city: "Apodaca" });
    const admin = buildEditionChanges(baseline, changed, true).patch;
    expect(admin).toMatchObject({ registration_mode: "FREE", registration_open_at: null, registration_close_at: "2026-11-13T10:00:00-06:00", city: "Apodaca" });
  });

  test("clearing the WhatsApp number sends null (the platform default applies)", () => {
    const baseline = editionToFormValues(edition);
    expect(buildEditionChanges(baseline, { ...baseline, whatsapp_phone_e164: "" }, false).patch).toEqual({ whatsapp_phone_e164: null });
  });
});

describe("eligibility, modalities and prices", () => {
  test("only filled criteria become rules; ages are bounded like the server", () => {
    expect(buildEligibility({ min_age: "18", max_age: "", sex_codes: ["F"] })).toEqual({ min_age: 18, sex_codes: ["F"] });
    expect(buildEligibility({ min_age: "", max_age: "", sex_codes: [] })).toEqual({});
    expect(Object.keys(validateEligibility({ min_age: "10", max_age: "120", sex_codes: [] })).sort()).toEqual(["max_age", "min_age"]);
    expect(validateEligibility({ min_age: "40", max_age: "30", sex_codes: [] }).max_age).toBeDefined();
    expect(describeEligibility({ min_age: 18, max_age: 39 })).toBe("18 a 39 años");
    expect(describeEligibility({ min_age: 40, sex_codes: ["M"] })).toBe("40 años o más · Varonil");
    expect(describeEligibility({})).toBe("Sin restricciones");
  });

  test("a modality body carries metres, a key and the creation-only capacity", () => {
    const values = { ...emptyModalityValues(), key: "10k", name: "10K", distance_km: "10", effective_capacity: "200", local_start_time: "06:30" };
    expect(validateModalityValues(values, "create")).toEqual({});
    expect(buildModalityBody(values, "create")).toEqual({
      key: "10k",
      name: "10K",
      generates_distance_credit: true,
      eligibility_rules: {},
      official_distance_m: 10000,
      local_start_time: "06:30",
      effective_capacity: 200,
    });
    // capacity is its own command after creation
    expect(buildModalityBody(values, "edit")).not.toHaveProperty("effective_capacity");
    expect(validateModalityValues({ ...values, key: "10 K", distance_km: "x" }, "create")).toMatchObject({ key: expect.any(String), distance_km: expect.any(String) });
  });

  test("a price body is minor units in MXN with windows in the Edition zone; zero is free", () => {
    const values = { name: "Preventa", amount: "250", starts_at: "2026-10-01T09:00", ends_at: "2026-10-31T23:59", status: "ACTIVE" as const };
    expect(validatePriceValues(values, "America/Monterrey")).toEqual({});
    expect(buildPriceBody(values, "America/Monterrey", "create")).toEqual({
      name: "Preventa",
      amount_minor: 25000,
      status: "ACTIVE",
      currency: "MXN",
      starts_at: "2026-10-01T09:00:00-06:00",
      ends_at: "2026-10-31T23:59:00-06:00",
    });
    expect(buildPriceBody({ ...values, amount: "0", starts_at: "", ends_at: "" }, "America/Monterrey", "edit")).toEqual({
      name: "Preventa",
      amount_minor: 0,
      status: "ACTIVE",
      starts_at: null,
      ends_at: null,
    });
    expect(validatePriceValues({ ...values, amount: "gratis" }, "America/Monterrey").amount).toBeDefined();
    expect(validatePriceValues({ ...values, ends_at: "2026-09-01T09:00" }, "America/Monterrey").ends_at).toBeDefined();
  });
});

describe("server refusals in plain language", () => {
  const failure = (code: string, details: Record<string, unknown>) => ({ code: code as never, requestId: "req-1", details });

  test("a refused publish lists the checks the server reported, never raw text", () => {
    const refusal = describeRefusal(failure("BUSINESS_RULE_VIOLATION", { reason: "not_ready", readiness: "publication", failed_checks: ["MODALITY_PRESENT", "DESCRIPTION_PRESENT"] }));
    expect(refusal.view.title).toBe("Faltan requisitos");
    expect(refusal.failedChecks).toEqual(["MODALITY_PRESENT", "DESCRIPTION_PRESENT"]);
    expect(refusal.view.requestId).toBe("req-1");
  });

  test("a taken slug is a conflict the operator can fix, not 'someone else changed it'", () => {
    const refusal = describeRefusal(failure("CONFLICT", { field: "slug", reason: "taken" }));
    expect(refusal.view.title).toBe("Ya existe");
    expect(refusal.reasons[0]).toContain("Enlace público");
  });

  test("a stale transition asks for a refresh", () => {
    const refusal = describeRefusal(failure("CONFLICT", { reason: "invalid_transition", field: "publication_state", current: "PUBLISHED" }));
    expect(refusal.view.action).toBe("reload");
  });

  test("lowering capacity below the occupation asks for an explicit acknowledgement", () => {
    const refusal = describeRefusal(failure("BUSINESS_RULE_VIOLATION", { reason: "capacity_below_occupation", confirmed: 12, active_holds: 3 }));
    expect(refusal.needsCapacityAcknowledgement).toEqual({ confirmed: 12, activeHolds: 3 });
    expect(refusal.reasons.join(" ")).toContain("12 confirmados");
  });

  test("an unknown reason degrades to the generic message", () => {
    const refusal = describeRefusal(failure("BUSINESS_RULE_VIOLATION", { reason: "something_new" }));
    expect(refusal.reasons).toEqual([]);
    expect(refusal.view.message).toBeTruthy();
  });
});
