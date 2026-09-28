import { describe, expect, test } from "vitest";
import { splitColumnsByPriority } from "@/lib/client/data-table";

const columns = [
  { key: "registration_number", priority: 1 },
  { key: "name", priority: 1 },
  { key: "pass_status", priority: 2 },
  { key: "modality", priority: 3 },
  { key: "category", priority: 3 },
  { key: "kit", priority: 4 },
];

describe("splitColumnsByPriority", () => {
  test("keeps the top-priority columns visible and collapses the rest, preserving original order", () => {
    const { visible, collapsed } = splitColumnsByPriority(columns, 3);

    expect(visible.map((c) => c.key)).toEqual(["registration_number", "name", "pass_status"]);
    expect(collapsed.map((c) => c.key)).toEqual(["modality", "category", "kit"]);
  });

  test("breaks priority ties by original column order", () => {
    const { visible } = splitColumnsByPriority(columns, 1);
    // Two columns share priority 1; the first one declared wins the single visible slot.
    expect(visible.map((c) => c.key)).toEqual(["registration_number"]);
  });

  test("keeps every column when keepCount meets or exceeds the column count", () => {
    const { visible, collapsed } = splitColumnsByPriority(columns, columns.length);
    expect(visible).toHaveLength(columns.length);
    expect(collapsed).toHaveLength(0);
  });

  test("collapses every column when keepCount is zero or negative", () => {
    const { visible, collapsed } = splitColumnsByPriority(columns, 0);
    expect(visible).toHaveLength(0);
    expect(collapsed).toHaveLength(columns.length);
  });

  test("does not mutate the input array", () => {
    const copy = [...columns];
    splitColumnsByPriority(columns, 2);
    expect(columns).toEqual(copy);
  });
});
