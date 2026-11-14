/**
 * CSV escaping shared by the contact import/export round-trip.
 *
 * Beyond RFC 4180 quoting, a cell that would be interpreted as a spreadsheet
 * formula is neutralized (OWASP CSV-injection guidance): a value beginning with
 * `=`, `+`, `-`, `@`, tab or carriage return gets a leading apostrophe so Excel
 * and Sheets treat it as text. Plain numbers and phone numbers are left alone
 * so `+15551234567` and `-5` stay readable.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const SAFE_NUMERIC = /^[+-]?\d[\d\s().-]*$/;

export function escapeCsvCell(value: string | null | undefined): string {
  const raw = value ?? "";
  const guarded = FORMULA_LEAD.test(raw) && !SAFE_NUMERIC.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}
