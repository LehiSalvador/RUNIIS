import "server-only";

// SEC-025: a cell a spreadsheet would evaluate (= + - @ tab CR, and their full-width forms) is made inert
// with a leading apostrophe; every field is quoted; the file starts with a UTF-8 BOM so Excel keeps accents.
const FORMULA_TRIGGER = /^[=+\-@\t\r＝＋－＠]/;
const BOM = "﻿";

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (FORMULA_TRIGGER.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
