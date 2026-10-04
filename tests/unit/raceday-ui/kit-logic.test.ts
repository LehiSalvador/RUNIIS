import { describe, expect, test } from "vitest";
import {
  buildKitDefinitionBody,
  buildKitDefinitionPatch,
  buildVariantBody,
  buildVariantPatch,
  emptyKitDefinition,
  emptyVariant,
  hasFieldErrors,
  inventoryTotals,
  isBelowAllocation,
  isLowStock,
  isoToLocalInput,
  kitToValues,
  localInputToIso,
  parseCapacity,
  validateKitDefinition,
  validateReason,
  validateVariant,
  variantToValues,
  type KitRow,
  type KitVariantRow,
} from "@/components/admin/raceday/kit-logic";

const TZ = "America/Monterrey";
const variant = (over: Partial<KitVariantRow> = {}): KitVariantRow => ({
  kit_variant_id: "v1",
  variant_key: "M",
  label: "Talla M",
  status: "ACTIVE",
  capacity: 40,
  allocated_count: 10,
  delivered_count: 4,
  pending_count: 5,
  exception_count: 1,
  available: 30,
  ...over,
});
const kit = (over: Partial<KitRow> = {}): KitRow => ({
  kit_definition_id: "k1",
  name: "Playera",
  status: "ACTIVE",
  pickup_start_at: null,
  pickup_end_at: null,
  instructions: null,
  variants: [variant()],
  ...over,
});

describe("pickup window in the Edition's own timezone", () => {
  test("a local time becomes the right instant and comes back unchanged", () => {
    // Monterrey is UTC-6 in October 2026 (no DST after 2022).
    expect(localInputToIso("2026-10-03T07:00", TZ)).toBe("2026-10-03T13:00:00.000Z");
    expect(isoToLocalInput("2026-10-03T13:00:00.000Z", TZ)).toBe("2026-10-03T07:00");
    expect(isoToLocalInput(localInputToIso("2026-12-31T23:30", TZ), TZ)).toBe("2026-12-31T23:30");
  });

  test("an impossible or malformed time is rejected, never rolled over", () => {
    expect(localInputToIso("2026-02-31T10:00", TZ)).toBeNull();
    expect(localInputToIso("2026-10-03", TZ)).toBeNull();
    expect(localInputToIso("garbage", TZ)).toBeNull();
    expect(isoToLocalInput(null, TZ)).toBe("");
    expect(isoToLocalInput("nope", TZ)).toBe("");
  });
});

describe("kit definition form", () => {
  test("a name is required, the window must close after it opens, instructions are bounded", () => {
    expect(validateKitDefinition(emptyKitDefinition(), TZ).name).toBeTruthy();
    const ok = { ...emptyKitDefinition(), name: "Playera" };
    expect(hasFieldErrors(validateKitDefinition(ok, TZ))).toBe(false);
    expect(validateKitDefinition({ ...ok, pickup_start: "2026-10-03T10:00", pickup_end: "2026-10-03T09:00" }, TZ).pickup_end).toBeTruthy();
    expect(validateKitDefinition({ ...ok, pickup_start: "2026-10-03T10:00", pickup_end: "2026-10-03T10:00" }, TZ).pickup_end).toBeTruthy();
    expect(validateKitDefinition({ ...ok, pickup_start: "2026-13-03T10:00" }, TZ).pickup_start).toBeTruthy();
    expect(validateKitDefinition({ ...ok, instructions: "x".repeat(2001) }, TZ).instructions).toBeTruthy();
    expect(validateKitDefinition({ ...ok, name: "x".repeat(121) }, TZ).name).toBeTruthy();
  });

  test("the create body carries only what was filled, with ISO instants and the initial sizes", () => {
    const values = { ...emptyKitDefinition(), name: " Playera ", pickup_start: "2026-10-03T08:00", instructions: " Con INE " };
    const body = buildKitDefinitionBody(values, TZ, [{ variant_key: "S", label: "Talla S", capacity: "", status: "ACTIVE" }]);
    expect(body).toEqual({
      name: "Playera",
      status: "ACTIVE",
      pickup_start_at: "2026-10-03T14:00:00.000Z",
      instructions: "Con INE",
      variants: [{ variant_key: "S", label: "Talla S", status: "ACTIVE" }],
    });
    expect(buildKitDefinitionBody(emptyKitDefinition(), TZ)).not.toHaveProperty("variants");
  });

  test("the patch has only the changed fields, and clearing a value sends null", () => {
    const initial = kitToValues(kit({ pickup_start_at: "2026-10-03T14:00:00.000Z", instructions: "Con INE" }), TZ);
    expect(initial.pickup_start).toBe("2026-10-03T08:00");
    expect(buildKitDefinitionPatch(initial, initial, TZ)).toBeNull();
    expect(buildKitDefinitionPatch(initial, { ...initial, name: "Playera 2026" }, TZ)).toEqual({ name: "Playera 2026" });
    expect(buildKitDefinitionPatch(initial, { ...initial, pickup_start: "", instructions: "" }, TZ)).toEqual({ pickup_start_at: null, instructions: null });
    expect(buildKitDefinitionPatch(initial, { ...initial, status: "INACTIVE" }, TZ)).toEqual({ status: "INACTIVE" });
  });
});

describe("variants (sizes)", () => {
  test("the key follows the server pattern and is only checked on create; the label is required", () => {
    expect(validateVariant({ ...emptyVariant(), variant_key: "M", label: "Talla M" }, { editing: false })).toEqual({});
    expect(validateVariant({ ...emptyVariant(), variant_key: "T M", label: "x" }, { editing: false }).variant_key).toBeTruthy();
    expect(validateVariant({ ...emptyVariant(), variant_key: "x".repeat(33), label: "x" }, { editing: false }).variant_key).toBeTruthy();
    expect(validateVariant({ ...emptyVariant(), variant_key: "", label: "x" }, { editing: true }).variant_key).toBeUndefined();
    expect(validateVariant({ ...emptyVariant(), variant_key: "M", label: " " }, { editing: false }).label).toBeTruthy();
  });

  test("capacity is a whole number up to 1,000,000, or empty for no limit", () => {
    expect(parseCapacity("")).toBeNull();
    expect(parseCapacity(" 40 ")).toBe(40);
    expect(parseCapacity("0")).toBe(0);
    expect(parseCapacity("-1")).toBe("invalid");
    expect(parseCapacity("4.5")).toBe("invalid");
    expect(parseCapacity("1000001")).toBe("invalid");
    expect(validateVariant({ ...emptyVariant(), variant_key: "M", label: "x", capacity: "abc" }, { editing: false }).capacity).toBeTruthy();
  });

  test("create body omits an empty capacity; patch sends null to remove the limit and the acknowledgement only when needed", () => {
    expect(buildVariantBody({ variant_key: " M ", label: " Talla M ", capacity: "", status: "ACTIVE" })).toEqual({ variant_key: "M", label: "Talla M", status: "ACTIVE" });
    expect(buildVariantBody({ variant_key: "M", label: "Talla M", capacity: "25", status: "INACTIVE" })).toMatchObject({ capacity: 25, status: "INACTIVE" });
    const initial = variantToValues(variant());
    expect(buildVariantPatch(initial, initial, false)).toBeNull();
    expect(buildVariantPatch(initial, { ...initial, capacity: "" }, false)).toEqual({ capacity: null });
    expect(buildVariantPatch(initial, { ...initial, capacity: "5" }, true)).toEqual({ capacity: 5, acknowledge_below_allocation: true });
    expect(buildVariantPatch(initial, { ...initial, capacity: "5" }, false)).toEqual({ capacity: 5 });
    expect(buildVariantPatch(initial, { ...initial, label: "M grande" }, true)).toEqual({ label: "M grande" });
  });

  test("a capacity under the live allocations needs acknowledgement", () => {
    expect(isBelowAllocation("5", 10)).toBe(true);
    expect(isBelowAllocation("10", 10)).toBe(false);
    expect(isBelowAllocation("", 10)).toBe(false);
    expect(isBelowAllocation("abc", 10)).toBe(false);
  });
});

describe("inventory", () => {
  test("totals add every variant of every kit", () => {
    expect(
      inventoryTotals([kit(), kit({ variants: [variant({ allocated_count: 2, delivered_count: 1, pending_count: 1, exception_count: 0 })] })]),
    ).toEqual({ allocated: 12, delivered: 5, pending: 6, exceptions: 1 });
    expect(inventoryTotals([])).toEqual({ allocated: 0, delivered: 0, pending: 0, exceptions: 0 });
  });

  test("low stock is when little is left; unlimited and inactive sizes are never low", () => {
    expect(isLowStock(variant({ capacity: 100, available: 10 }))).toBe(true);
    expect(isLowStock(variant({ capacity: 100, available: 11 }))).toBe(false);
    expect(isLowStock(variant({ capacity: 5, available: 0 }))).toBe(true);
    expect(isLowStock(variant({ capacity: null, available: null }))).toBe(false);
    expect(isLowStock(variant({ status: "INACTIVE", capacity: 10, available: 0 }))).toBe(false);
  });

  test("a reason is required and bounded", () => {
    expect(validateReason("  ")).toMatch(/obligatorio/);
    expect(validateReason("x".repeat(501))).toBeTruthy();
    expect(validateReason("Su hermano")).toBeUndefined();
  });
});
