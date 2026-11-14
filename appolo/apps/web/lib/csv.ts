import { escapeCsvCell } from "@appolo/core";

/** Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Skip fully empty trailing lines.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      // swallow; \n handles the row break
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

export function csvEscape(value: string | null | undefined): string {
  return escapeCsvCell(value);
}

export function toCsv(headers: string[], rows: (string | null | undefined)[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Splits a tag cell like "vip, repeat, 2024" into clean tag names. */
export function splitTags(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20);
}