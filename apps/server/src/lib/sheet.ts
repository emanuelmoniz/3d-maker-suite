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
  return parseCsv(text).map((cells, i) => ({ n: i + 1, cells }));
}

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
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet(sheets.data, { views: [{ state: "frozen", ySplit: 1 }] });
  const help = wb.addWorksheet(sheets.instructions);
  const lists = wb.addWorksheet(sheets.lists);
  const label = (c: ImportColumn) => labels[c.key] ?? c.key;
  data.columns = columns.map((c) => {
    const header = `${label(c)}${c.required ? " *" : ""}`;
    // Dates show as ISO; text stays text, so a colour like 000000 isn't turned into 0.
    const numFmt = c.type === "date" ? "yyyy-mm-dd" : c.type === "color" ? "@" : undefined;
    return { header, width: Math.max(14, header.length + 2), style: numFmt ? { numFmt } : {} };
  });
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
    for (let r = 2; r <= ROWS + 1; r++) data.getCell(r, i + 1).dataValidation = validation;
  });
  lists.getRow(1).font = { bold: true };

  help.addRows(instructions);
  for (const col of help.columns) col.width = 32;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
