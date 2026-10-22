import { type ImportColumn, type ImportTemplate, parseCsv } from "@3d-maker-suite/core";
import ExcelJS from "exceljs";

// The only file that knows exceljs, so replacing it is a change here.
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A file row: its line number and raw cells (text, numbers, ISO dates). */
export type GridRow = { n: number; cells: unknown[] };

// A cell without its formatting: rich text, links and formulas become their text / last result.
function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (!v || typeof v !== "object") return v;
  if ("richText" in v) return (v.richText as { text: string }[]).map((r) => r.text).join("");
  if ("text" in v) return plain(v.text);
  return "result" in v ? plain(v.result) : null;
}

/** The first sheet of a workbook, empty rows left out. */
export async function readXlsx(file: Buffer): Promise<GridRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  const rows: GridRow[] = [];
  // `row.values` is 1-based and sparse.
  wb.worksheets[0]?.eachRow((row, n) =>
    rows.push({ n, cells: Array.from(row.values as unknown[], plain).slice(1) }),
  );
  return rows;
}

export function readCsv(file: Buffer): GridRow[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file);
  } catch {
    // ponytail: Excel's plain "CSV" on Windows isn't UTF-8; sniff the code page if 1252 misreads.
    text = new TextDecoder("windows-1252").decode(file);
  }
  // The quote `csvCell` puts before a formula-like text goes again.
  return parseCsv(text).map((cells, i) => ({
    n: i + 1,
    cells: cells.map((c) => (/^'[=+\-@\t\r]/.test(c) ? c.slice(1) : c)),
  }));
}

/** A column's header in every format: its translated label, `*` when required. */
const header = (c: ImportColumn, labels: Record<string, string>) =>
  `${labels[c.key] ?? c.key}${c.required ? " *" : ""}`;
/** A stored value as a file holds it: money in major units. */
const fileValue = (c: ImportColumn, v: unknown) =>
  c.type === "money" && typeof v === "number" ? v / 100 : (v ?? null);

/** Existing rows to write into an export, with their id in a first column. */
type ExportRows = { id: string; values: Record<string, unknown> }[];

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  // Text starting like a formula (e.g. a synced name "=HYPERLINK(...)") would run in Excel.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** The template (or, with `rows`, the export) as CSV, with a BOM so Excel reads UTF-8. */
export function buildCsv(
  columns: readonly ImportColumn[],
  labels: Record<string, string>,
  rows?: ExportRows,
) {
  const lines = [
    [...(rows ? ["id"] : []), ...columns.map((c) => header(c, labels))],
    ...(rows ?? []).map((r) => [r.id, ...columns.map((c) => fileValue(c, r.values[c.key]))]),
  ];
  return `﻿${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** The template (`[]`) or the export as JSON: objects by column key. */
export const buildJson = (columns: readonly ImportColumn[], rows: ExportRows = []) =>
  rows.map((r) => ({
    id: r.id,
    ...Object.fromEntries(columns.map((c) => [c.key, fileValue(c, r.values[c.key])])),
  }));

/** Rows of the data sheet that get dropdowns. */
const ROWS = 1000;

/**
 * The template: a data sheet with one column per `columns` entry (dropdowns for options and for
 * the names in `refs`), the instructions, and the lists the dropdowns read.
 */
export async function buildTemplate(
  columns: readonly ImportColumn[],
  { labels, sheets, instructions }: ImportTemplate,
  refs: Record<string, string[]>,
  /** Export: existing rows to fill in, with their id in a first column. */
  rows?: ExportRows,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet(sheets.data, { views: [{ state: "frozen", ySplit: 1 }] });
  const help = wb.addWorksheet(sheets.instructions);
  const lists = wb.addWorksheet(sheets.lists);
  const label = (c: ImportColumn) => labels[c.key] ?? c.key;
  // The export's id column is the first one, so every other column shifts right.
  const shift = rows ? 1 : 0;
  data.columns = [
    ...(rows ? [{ header: "id", key: "id", width: 38 }] : []),
    ...columns.map((c) => {
      const head = header(c, labels);
      // Dates show as ISO; text stays text, so a colour like 000000 isn't turned into 0.
      const numFmt =
        c.type === "date"
          ? "yyyy-mm-dd"
          : c.type === "datetime"
            ? "yyyy-mm-dd hh:mm"
            : c.type === "color"
              ? "@"
              : undefined;
      return {
        header: head,
        width: Math.max(14, head.length + 2),
        style: numFmt ? { numFmt } : {},
      };
    }),
  ];
  for (const r of rows ?? [])
    data.addRow([r.id, ...columns.map((c) => fileValue(c, r.values[c.key]))]);
  data.getRow(1).font = { bold: true };

  let listColumn = 0;
  columns.forEach((c, i) => {
    let formula = c.type === "enum" && c.options ? `"${c.options.join(",")}"` : "";
    if (c.ref) {
      const names = refs[c.ref] ?? [];
      const col = lists.getColumn(++listColumn);
      col.values = [label(c), ...names];
      col.width = 30;
      if (names.length)
        formula = `'${sheets.lists.replaceAll("'", "''")}'!$${col.letter}$2:$${col.letter}$${names.length + 1}`;
    }
    if (!formula) return;
    // A name list only suggests: a new brand can still be typed.
    const validation = {
      type: "list" as const,
      allowBlank: true,
      showErrorMessage: !c.ref,
      formulae: [formula],
    };
    for (let r = 2; r <= ROWS + 1; r++) data.getCell(r, i + 1 + shift).dataValidation = validation;
  });
  lists.getRow(1).font = { bold: true };

  help.addRows(instructions);
  for (const col of help.columns) col.width = 32;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
