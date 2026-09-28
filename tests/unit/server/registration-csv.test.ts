import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/server/domain/registration/csv";

// SEC-025 formula-injection escaping for participants/export.csv (Master §172).
describe("registration csv export", () => {
  it("quotes every cell and CRLF-terminates rows, with a leading BOM", () => {
    const csv = toCsv(["a", "b"], [["1", "2"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"a","b"\r\n"1","2"\r\n');
  });

  it("neutralises every formula trigger Excel/Sheets recognise with a leading apostrophe", () => {
    for (const dangerous of ["=cmd|'/C calc'!A1", "+1+1", "-1+1", "@SUM(A1:A9)", "\tevil", "\revil", "＝formula", "＋formula", "－formula", "＠formula"]) {
      expect(csvCell(dangerous)).toBe(`"'${dangerous}"`);
    }
  });

  it("leaves ordinary text, numbers and booleans untouched", () => {
    expect(csvCell("María Nómez")).toBe('"María Nómez"');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(true)).toBe('"true"');
    expect(csvCell(false)).toBe('"false"');
  });

  it("also neutralises a negative number (safe-by-default: a leading '-' is a formula trigger for any value, numeric or not)", () => {
    expect(csvCell(-5)).toBe('"\'-5"');
  });

  it("renders null/undefined as an empty quoted cell, never the literal word", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("escapes embedded double quotes (RFC 4180) without breaking the trigger check", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=say "hi"')).toBe('"\'=say ""hi"""');
  });

  it("does not treat a value that merely contains a trigger character mid-string as dangerous", () => {
    expect(csvCell("5-10K")).toBe('"5-10K"');
    expect(csvCell("a@b.com in a cell")).toBe('"a@b.com in a cell"');
  });
});
