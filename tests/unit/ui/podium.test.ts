import { describe, expect, test } from "vitest";
import { arrangePodium } from "@/lib/client/podium";

const person = (id: string, rank: number) => ({ id, rank });

describe("arrangePodium", () => {
  test("places three distinct ranks on first/second/third pedestals", () => {
    expect(arrangePodium([person("c", 3), person("a", 1), person("b", 2)])).toEqual({
      mode: "pedestal",
      slots: [
        { occupant: person("a", 1), place: "first" },
        { occupant: person("b", 2), place: "second" },
        { occupant: person("c", 3), place: "third" },
      ],
    });
  });

  test("keeps every person of a 1,1,3 tie on the pedestals, by finishing order", () => {
    const layout = arrangePodium([person("a", 1), person("b", 1), person("c", 3)]);
    expect(layout.mode).toBe("pedestal");
    if (layout.mode !== "pedestal") return;
    expect(layout.slots.map((s) => [s.occupant.id, s.place])).toEqual([
      ["a", "first"],
      ["b", "second"],
      ["c", "third"],
    ]);
  });

  test("switches to a ranked list when ties push more than three people into the top three", () => {
    expect(arrangePodium([person("a", 1), person("b", 2), person("c", 2), person("d", 2), person("e", 5)])).toEqual({
      mode: "list",
      rows: [person("a", 1), person("b", 2), person("c", 2), person("d", 2)],
    });
  });

  test("ignores occupants outside ranks 1-3 and handles partial podiums", () => {
    expect(arrangePodium([person("a", 1), person("x", 4)])).toEqual({
      mode: "pedestal",
      slots: [{ occupant: person("a", 1), place: "first" }],
    });
    expect(arrangePodium([])).toEqual({ mode: "pedestal", slots: [] });
  });
});
