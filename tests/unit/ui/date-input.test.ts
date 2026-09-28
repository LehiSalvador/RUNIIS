import { describe, expect, test } from "vitest";
import { displayToIso, isoToDisplay, maskDateDigits } from "@/lib/client/date-input";

describe("maskDateDigits", () => {
  test("inserts separators after day and month while typing", () => {
    expect(maskDateDigits("1")).toBe("1");
    expect(maskDateDigits("120")).toBe("12/0");
    expect(maskDateDigits("12031")).toBe("12/03/1");
    expect(maskDateDigits("12031990")).toBe("12/03/1990");
  });

  test("drops non-digits and anything past eight digits", () => {
    expect(maskDateDigits("12-03-1990 99")).toBe("12/03/1990");
    expect(maskDateDigits("ab")).toBe("");
  });

  test("backspacing over a separator does not re-add it", () => {
    expect(maskDateDigits("12/")).toBe("12");
  });
});

describe("displayToIso", () => {
  test("converts a complete, real date", () => {
    expect(displayToIso("29/02/2024")).toBe("2024-02-29");
  });

  test("rejects impossible dates instead of rolling them over", () => {
    expect(displayToIso("29/02/2025")).toBeNull();
    expect(displayToIso("31/04/2026")).toBeNull();
    expect(displayToIso("00/01/2026")).toBeNull();
    expect(displayToIso("10/13/2026")).toBeNull();
  });

  test("rejects incomplete input", () => {
    expect(displayToIso("12/03/19")).toBeNull();
    expect(displayToIso("")).toBeNull();
  });
});

describe("isoToDisplay", () => {
  test("round-trips with displayToIso", () => {
    expect(isoToDisplay("1990-03-12")).toBe("12/03/1990");
    expect(displayToIso(isoToDisplay("1990-03-12"))).toBe("1990-03-12");
  });

  test("returns empty text for missing or malformed values", () => {
    expect(isoToDisplay(undefined)).toBe("");
    expect(isoToDisplay("12/03/1990")).toBe("");
  });
});
