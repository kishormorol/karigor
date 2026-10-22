/**
 * CSV for spreadsheets (Excel, Google Sheets). Serve it from a GET route:
 *   return csvResponse("visits-2026-10.csv", toCsv(rows, [{ key: "date", label: "Date" }, ...]));
 * Check the person's permission in the route first, as in any page.
 */
export interface CsvColumn<T> {
  key: keyof T & string;
  label: string;
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Quote anything with a comma, quote or line break; a leading = + - @ could run as a formula, so it is quoted with a ' first.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell(r[c.key])).join(","))];
  // The byte-order mark makes Excel read Bangla and the taka sign correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"` } });
}
