/**
 * CSV export.
 *
 * Two hazards are handled here, both of which have bitten real dashboards:
 *
 *  - Spreadsheet formula injection: a cell beginning `=`, `+`, `-`, `@`, tab or
 *    carriage return is executed as a formula by Excel and Sheets when the file
 *    is opened. A visitor id, search term or user name is attacker-controlled,
 *    so every such cell is prefixed with an apostrophe and quoted.
 *  - Naive quoting: a value containing a quote, comma or newline must be quoted
 *    with quotes doubled, or the file parses into the wrong columns.
 */

export interface CsvColumn {
  key: string;
  header: string;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  // A real number is never a formula: it keeps its numeric form so a spreadsheet
  // can still sum the column. Only text can carry an injected formula.
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

  if (FORMULA_START.test(text)) {
    // Leading apostrophe: spreadsheets treat the cell as text and never run it.
    // It is quoted as well, so the neutralised value is unambiguous in the file.
    return `"'${text.replace(/"/g, '""')}"`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map((column) => csvCell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(','));
  // A trailing newline keeps diffs and `wc -l` honest.
  return [header, ...body].join('\r\n') + '\r\n';
}
