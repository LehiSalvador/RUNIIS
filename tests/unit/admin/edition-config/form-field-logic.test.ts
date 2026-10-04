import { describe, expect, test } from "vitest";
import {
  MAX_FORM_FIELDS,
  buildFieldBody,
  buildFieldsBody,
  describeFieldRules,
  fieldDraftFromServer,
  fieldKeyFromLabel,
  fieldsSignature,
  isValidFieldKey,
  isValidOptionValue,
  moveItem,
  newFieldDraft,
  newOption,
  optionValueFromLabel,
  validateFieldDrafts,
  type FieldDraft,
} from "@/components/admin/edition-config/form-field-logic";

function draft(patch: Partial<FieldDraft> = {}): FieldDraft {
  return { ...newFieldDraft(), label: "Talla de playera", field_key: "talla_de_playera", ...patch };
}

describe("field keys and option values", () => {
  test("a key follows the label in the server's key alphabet", () => {
    expect(fieldKeyFromLabel("Talla de playera")).toBe("talla_de_playera");
    expect(fieldKeyFromLabel("¿Contacto de emergencia?")).toBe("contacto_de_emergencia");
    expect(fieldKeyFromLabel("5 km favoritos")).toBe("km_favoritos");
    expect(fieldKeyFromLabel("x".repeat(100)).length).toBeLessThanOrEqual(64);
    expect(isValidFieldKey(fieldKeyFromLabel("Alergias / condiciones"))).toBe(true);
  });

  test("the key rule is the server's", () => {
    expect(isValidFieldKey("talla")).toBe(true);
    expect(isValidFieldKey("Talla")).toBe(false);
    expect(isValidFieldKey("1talla")).toBe(false);
    expect(isValidFieldKey("talla-s")).toBe(false);
    expect(isValidFieldKey("")).toBe(false);
  });

  test("an option value is a short token; a label becomes one", () => {
    expect(isValidOptionValue("talla_s")).toBe(true);
    expect(isValidOptionValue("A.b-c_1")).toBe(true);
    expect(isValidOptionValue("con espacio")).toBe(false);
    expect(isValidOptionValue("")).toBe(false);
    expect(optionValueFromLabel("Talla S (chica)")).toBe("talla_s_chica");
  });
});

describe("the body sent to PUT /forms/:id/fields", () => {
  test("only the settings of the type travel, and the order is the sort order", () => {
    const text = draft({ field_type: "TEXT", min_length: "2", max_length: "40", min: "9", max: "9", integer: true });
    const body = buildFieldBody(text, 0);
    expect(body).toMatchObject({ field_key: "talla_de_playera", field_type: "TEXT", sort_order: 1, validation_config: { min_length: 2, max_length: 40 }, options_config: {} });
    expect(body.validation_config).not.toHaveProperty("min");
    expect(body.validation_config).not.toHaveProperty("integer");

    const number = buildFieldBody(draft({ field_type: "NUMBER", min: "0", max: "120", integer: true, min_length: "3" }), 1);
    expect(number.validation_config).toEqual({ min: 0, max: 120, integer: true });
    expect(number.sort_order).toBe(2);

    const date = buildFieldBody(draft({ field_type: "DATE", min_date: "1950-01-01", max_date: "2011-12-31" }), 0);
    expect(date.validation_config).toEqual({ min_date: "1950-01-01", max_date: "2011-12-31" });

    expect(buildFieldBody(draft({ field_type: "BOOLEAN", min_length: "9" }), 0).validation_config).toEqual({});
  });

  test("a list field carries its options and its limits", () => {
    const body = buildFieldBody(
      draft({
        field_type: "MULTISELECT",
        options: [
          { uid: "o1", value: "s", label: "S " },
          { uid: "o2", value: "m", label: "M" },
        ],
        min_items: "1",
        max_items: "2",
      }),
      0,
    );
    expect(body.options_config).toEqual({ options: [{ value: "s", label: "S" }, { value: "m", label: "M" }] });
    expect(body.validation_config).toEqual({ min_items: 1, max_items: 2 });
    expect(buildFieldBody(draft({ field_type: "TEXT", options: [newOption()] }), 0).options_config).toEqual({});
  });

  test("the whole list is sent (the API replaces it) and its signature changes only when the content does", () => {
    const a = draft({ label: "A", field_key: "a" });
    const b = draft({ label: "B", field_key: "b" });
    expect((buildFieldsBody([a, b]).fields as unknown[]).length).toBe(2);
    expect(fieldsSignature([a, b])).toBe(fieldsSignature([{ ...a, uid: "other-a" }, { ...b, uid: "other-b" }]));
    expect(fieldsSignature([a, b])).not.toBe(fieldsSignature([b, a]));
    expect(fieldsSignature([a, b])).not.toBe(fieldsSignature([{ ...a, required: true }, b]));
  });

  test("a field read from the server round-trips to the same body", () => {
    const server = {
      field_key: "talla",
      label: "Talla",
      field_type: "SELECT" as const,
      required: true,
      validation_config: {},
      options_config: { options: [{ value: "s", label: "S" }, { value: "m", label: "M" }] },
      sensitivity: "NORMAL" as const,
    };
    const body = buildFieldBody(fieldDraftFromServer(server), 3);
    expect(body).toEqual({ ...server, sort_order: 4 });
  });
});

describe("validation of the field list", () => {
  test("a clean list has no errors", () => {
    expect(validateFieldDrafts([draft(), draft({ label: "Edad", field_key: "edad", field_type: "NUMBER", min: "15", max: "100" })])).toEqual({});
    expect(validateFieldDrafts([])).toEqual({});
  });

  test("label and key are required and the key is the server's", () => {
    const empty = newFieldDraft();
    const errors = validateFieldDrafts([empty, draft({ field_key: "Bad-Key" })]);
    expect(errors[empty.uid]).toMatchObject({ label: expect.any(String), field_key: expect.any(String) });
    expect(Object.values(errors).flatMap((entry) => Object.keys(entry))).toContain("field_key");
  });

  test("two fields cannot share a key", () => {
    const first = draft();
    const second = draft({ label: "Otra" });
    const errors = validateFieldDrafts([first, second]);
    expect(errors[first.uid]).toBeUndefined();
    expect(errors[second.uid]?.field_key).toContain("ya usa");
  });

  test("a list field needs valid, unique options", () => {
    const none = draft({ field_type: "SELECT", options: [] });
    expect(validateFieldDrafts([none])[none.uid]?.options).toContain("al menos una");

    const bad = draft({
      field_type: "SELECT",
      options: [
        { uid: "o1", value: "s", label: "S" },
        { uid: "o2", value: "s", label: "Chica" },
        { uid: "o3", value: "con espacio", label: "X" },
        { uid: "o4", value: "", label: "" },
      ],
    });
    const errors = validateFieldDrafts([bad])[bad.uid];
    expect(errors?.["option:o2:value"]).toContain("ya usa");
    expect(errors?.["option:o3:value"]).toBeDefined();
    expect(errors?.["option:o4:value"]).toBeDefined();
    expect(errors?.["option:o4:label"]).toBeDefined();
    expect(errors?.["option:o1:value"]).toBeUndefined();
  });

  test("limits are ordered and inside the server's ranges", () => {
    const text = draft({ field_type: "TEXT", min_length: "50", max_length: "10" });
    expect(validateFieldDrafts([text])[text.uid]?.max_length).toContain("menor");
    const tooLong = draft({ field_type: "TEXT", max_length: "201" });
    expect(validateFieldDrafts([tooLong])[tooLong.uid]?.max_length).toContain("entre 1 y 200");
    const area = draft({ field_type: "TEXTAREA", max_length: "2000" });
    expect(validateFieldDrafts([area])).toEqual({});
    const num = draft({ field_type: "NUMBER", min: "10", max: "5" });
    expect(validateFieldDrafts([num])[num.uid]?.max).toContain("menor");
    const notNumber = draft({ field_type: "NUMBER", min: "abc" });
    expect(validateFieldDrafts([notNumber])[notNumber.uid]?.min).toBeDefined();
    const date = draft({ field_type: "DATE", min_date: "2020-01-02", max_date: "2020-01-01" });
    expect(validateFieldDrafts([date])[date.uid]?.max_date).toContain("anterior");
    const multi = draft({ field_type: "MULTISELECT", options: [{ uid: "o1", value: "a", label: "A" }], min_items: "0", max_items: "3" });
    expect(validateFieldDrafts([multi])[multi.uid]?.max_items).toContain("entre 1 y 1");
  });

  test("a form admits at most the server's number of fields", () => {
    const many = Array.from({ length: MAX_FORM_FIELDS + 1 }, (_, index) => draft({ label: `P${index}`, field_key: `p${index}` }));
    const errors = validateFieldDrafts(many);
    expect(errors[many[MAX_FORM_FIELDS].uid]?.label).toContain(String(MAX_FORM_FIELDS));
  });
});

describe("reordering and describing", () => {
  test("move swaps within bounds and leaves the input alone", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 2, 3)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });

  test("a published field is described by its type, requirement and limits", () => {
    expect(describeFieldRules({ field_type: "TEXT", required: true, validation_config: { min_length: 2, max_length: 40 }, options_config: {}, sensitivity: "NORMAL" })).toBe(
      "Texto corto · obligatorio · 2 a 40 caracteres",
    );
    expect(
      describeFieldRules({ field_type: "SELECT", required: false, validation_config: {}, options_config: { options: [{ value: "a", label: "A" }] }, sensitivity: "SENSITIVE" }),
    ).toBe("Lista (una opción) · opcional · 1 opción · dato sensible");
    expect(describeFieldRules({ field_type: "NUMBER", required: false, validation_config: { min: 0, integer: true }, options_config: {}, sensitivity: "NORMAL" })).toBe(
      "Número · opcional · mínimo 0 · entero",
    );
  });
});
