import { describe, expect, test } from "vitest";
import {
  createContentBlockBodySchema,
  createEditionBodySchema,
  createKitVariantBodySchema,
  createModalityBodySchema,
  createRegistrationFormBodySchema,
  documentKeyParamSchema,
  eligibilityRulesSchema,
  scheduleInputSchema,
  setModalityCapacityBodySchema,
  updateKitVariantBodySchema,
} from "@/lib/server/domain/events/contracts";

// Contract-level tests for the events domain's zod boundary (SEC-005/120): unknown fields, ranges
// and formats must fail closed here, before a request ever reaches the database. Deep business
// validation (SQL cfg_* helpers) is exercised in supabase/tests/database/20[1-4]_events_*.test.sql.

describe("eligibilityRulesSchema (KERNEL_READY v1: {} = everyone, V1 15+)", () => {
  test("accepts the empty object", () => {
    expect(eligibilityRulesSchema.parse({})).toEqual({});
  });

  test("accepts a full valid rule set", () => {
    const parsed = eligibilityRulesSchema.parse({ min_age: 18, max_age: 39, sex_codes: ["F", "M"] });
    expect(parsed).toEqual({ min_age: 18, max_age: 39, sex_codes: ["F", "M"] });
  });

  test("rejects an age below 15 or above 100", () => {
    expect(() => eligibilityRulesSchema.parse({ min_age: 14 })).toThrow();
    expect(() => eligibilityRulesSchema.parse({ max_age: 101 })).toThrow();
  });

  test("rejects an empty sex_codes array and an unknown code", () => {
    expect(() => eligibilityRulesSchema.parse({ sex_codes: [] })).toThrow();
    expect(() => eligibilityRulesSchema.parse({ sex_codes: ["Z"] })).toThrow();
  });

  test("rejects an unknown key", () => {
    expect(() => eligibilityRulesSchema.parse({ min_age: 18, other: 1 })).toThrow();
  });
});

describe("scheduleInputSchema", () => {
  test("requires local_date and rejects an unknown key", () => {
    expect(() => scheduleInputSchema.parse({})).toThrow();
    expect(() => scheduleInputSchema.parse({ local_date: "2026-12-01", extra: 1 })).toThrow();
  });

  test("accepts a date with optional times", () => {
    expect(scheduleInputSchema.parse({ local_date: "2026-12-01", local_start_time: "07:00:00" }).local_date).toBe("2026-12-01");
  });

  test("rejects a malformed date", () => {
    expect(() => scheduleInputSchema.parse({ local_date: "12/01/2026" })).toThrow();
  });
});

describe("createEditionBodySchema", () => {
  const base = {
    slug: "carrera-demo",
    name: "Carrera Demo",
    registration_mode: "FREE" as const,
    city: "Monterrey",
    state_region: "NL",
  };

  test("accepts the minimal required shape", () => {
    expect(createEditionBodySchema.parse(base).slug).toBe("carrera-demo");
  });

  test("rejects an unknown field (SEC-016/120)", () => {
    expect(() => createEditionBodySchema.parse({ ...base, primary_location_id: "x" })).toThrow();
  });

  test("rejects a registration_close_at that is not RFC3339 with an offset", () => {
    expect(() => createEditionBodySchema.parse({ ...base, registration_close_at: "2026-12-01 07:00:00" })).toThrow();
    expect(createEditionBodySchema.parse({ ...base, registration_close_at: "2026-12-01T07:00:00Z" }).registration_close_at).toBe(
      "2026-12-01T07:00:00Z",
    );
  });

  test("rejects a global_capacity out of bounds", () => {
    expect(() => createEditionBodySchema.parse({ ...base, global_capacity: -1 })).toThrow();
  });

  test("rejects a non-E.164 whatsapp number", () => {
    expect(() => createEditionBodySchema.parse({ ...base, whatsapp_phone_e164: "8110000000" })).toThrow();
  });
});

describe("createModalityBodySchema / setModalityCapacityBodySchema", () => {
  test("requires key and name; rejects an out-of-range distance", () => {
    expect(() => createModalityBodySchema.parse({ name: "5K" })).toThrow();
    expect(() => createModalityBodySchema.parse({ key: "5k", name: "5K", official_distance_m: 0 })).toThrow();
    expect(createModalityBodySchema.parse({ key: "5k", name: "5K", official_distance_m: 5000 }).key).toBe("5k");
  });

  test("capacity accepts null (unlimited) but rejects a negative number", () => {
    expect(setModalityCapacityBodySchema.parse({ effective_capacity: null }).effective_capacity).toBeNull();
    expect(() => setModalityCapacityBodySchema.parse({ effective_capacity: -1 })).toThrow();
  });
});

describe("createRegistrationFormBodySchema (Master §41 field schema v1)", () => {
  test("accepts a SELECT field with options_config", () => {
    const parsed = createRegistrationFormBodySchema.parse({
      fields: [
        {
          field_key: "t_shirt",
          label: "Talla",
          field_type: "SELECT",
          options_config: { options: [{ value: "S", label: "S" }] },
        },
      ],
    });
    expect(parsed.fields?.[0]?.field_key).toBe("t_shirt");
  });

  test("rejects a field_key with uppercase or leading digit", () => {
    expect(() =>
      createRegistrationFormBodySchema.parse({ fields: [{ field_key: "TShirt", label: "Talla", field_type: "TEXT" }] }),
    ).toThrow();
    expect(() =>
      createRegistrationFormBodySchema.parse({ fields: [{ field_key: "1shirt", label: "Talla", field_type: "TEXT" }] }),
    ).toThrow();
  });

  test("rejects more than 50 fields", () => {
    const fields = Array.from({ length: 51 }, (_, i) => ({ field_key: `f${i}`, label: `F${i}`, field_type: "TEXT" as const }));
    expect(() => createRegistrationFormBodySchema.parse({ fields })).toThrow();
  });
});

describe("content blocks (SEC-061: markdown text only, payload shape per block_type is SQL-enforced)", () => {
  test("accepts a well-formed RICH_TEXT create body", () => {
    const parsed = createContentBlockBodySchema.parse({ block_type: "RICH_TEXT", payload: { markdown: "Texto de prueba." } });
    expect(parsed.block_type).toBe("RICH_TEXT");
  });

  test("rejects an unknown block_type", () => {
    expect(() => createContentBlockBodySchema.parse({ block_type: "VIDEO", payload: {} })).toThrow();
  });

  test("rejects a missing payload", () => {
    expect(() => createContentBlockBodySchema.parse({ block_type: "RICH_TEXT" })).toThrow();
  });
});

describe("kit variants", () => {
  test("create requires variant_key matching the SQL charset", () => {
    expect(() => createKitVariantBodySchema.parse({ variant_key: "S M", label: "Chica" })).toThrow();
    expect(createKitVariantBodySchema.parse({ variant_key: "S", label: "Chica" }).variant_key).toBe("S");
  });

  test("update accepts a null capacity (unlimited) and the acknowledgement flag", () => {
    const parsed = updateKitVariantBodySchema.parse({ capacity: null, acknowledge_below_allocation: true });
    expect(parsed.capacity).toBeNull();
    expect(parsed.acknowledge_below_allocation).toBe(true);
  });
});

describe("documentKeyParamSchema (public GET /api/v1/legal/:documentKey)", () => {
  test("accepts a well-formed key and rejects path-hostile input", () => {
    expect(documentKeyParamSchema.parse({ documentKey: "TERMS_OF_SERVICE" }).documentKey).toBe("TERMS_OF_SERVICE");
    expect(() => documentKeyParamSchema.parse({ documentKey: "../../etc/passwd" })).toThrow();
    expect(() => documentKeyParamSchema.parse({ documentKey: "" })).toThrow();
  });
});
