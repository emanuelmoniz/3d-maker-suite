import type {
  ImportAction,
  ImportApplyDecision,
  ImportCell,
  ImportColumn,
  ImportErrorCode,
  ImportPreviewRow,
  ImportStatus,
  ImportValues,
  MergePolicy,
} from "../schemas/import.ts";

/**
 * CSV text to rows of cells. The delimiter (`,` `;` or tab) is the one the header line uses most;
 * quoted cells may hold delimiters, line breaks and `""`.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => header.split(d).length;
  const delimiter = [",", ";", "\t"].reduce((a, b) => (count(b) > count(a) ? b : a));
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') cell += text[i++];
      else quoted = false;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      rows.push([...row, cell]);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** Compares headers and names the way a person reads them: no case, spaces or punctuation. */
const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** The column key of each file header (its key or its translated label), or null. */
export const headerKeys = (
  columns: readonly ImportColumn[],
  headers: unknown[],
  labels: Record<string, string> = {},
) =>
  headers.map(
    (h) =>
      columns.find((c) => norm(h) && [c.key, labels[c.key]].some((n) => norm(n) === norm(h)))
        ?.key ?? null,
  );

// The last separator is the decimal one ("1.234,56", "1,234.56"); a lone comma is a decimal comma.
// ponytail: a lone dot is always a decimal point, so "1.234" is never one thousand.
function toNumber(raw: string | number): number {
  if (typeof raw === "number") return raw;
  let s = raw.replace(/\s/g, "");
  if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replaceAll(".", "").replace(",", ".");
  else s = s.replaceAll(",", "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

const isDate = (d: string) => !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

/** One raw cell (text, or a number / ISO date from a spreadsheet) to the column's value. */
export function parseCell(
  col: ImportColumn,
  raw: unknown,
): { value: ImportCell } | { error: ImportErrorCode } {
  const text = typeof raw === "string" ? raw.trim() : raw;
  if (text == null || text === "") return col.required ? { error: "required" } : { value: null };
  if (col.type === "number" || col.type === "integer" || col.type === "money") {
    const n = toNumber(typeof text === "number" ? text : String(text));
    if (Number.isNaN(n) || (col.type === "integer" && !Number.isInteger(n)))
      return { error: "not_a_number" };
    // ponytail: every numeric column so far is a weight or a price; add `min` when one isn't.
    if (n < 0) return { error: "negative" };
    return { value: col.type === "money" ? Math.round(n * 100) : n };
  }
  const s = String(text);
  if (col.type === "date") {
    // Only ISO dates: "03/04/2026" is March or April depending on who typed it.
    const day = /^(\d{4}-\d{2}-\d{2})(T|$)/.exec(s)?.[1];
    return day && isDate(day) ? { value: day } : { error: "not_a_date" };
  }
  if (col.type === "datetime") {
    // ponytail: a time without a zone is read as UTC, as spreadsheets hand it over; add a
    // time-zone setting if people type local times.
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      s,
    );
    const at =
      m &&
      new Date(
        `${m[1]}T${m[2]}${m[3] ?? ":00"}${m[4] ?? ""}${(m[5] ?? "Z").replace(/(\d{2})(\d{2})$/, "$1:$2")}`,
      );
    return at && !Number.isNaN(at.getTime())
      ? { value: `${at.toISOString().slice(0, 19)}Z` }
      : { error: "not_a_datetime" };
  }
  if (col.type === "color")
    return /^#?[0-9a-f]{6}$/i.test(s)
      ? { value: `#${s.replace("#", "").toLowerCase()}` }
      : { error: "not_a_color" };
  if (col.type === "enum") {
    const option = col.options?.find((o) => norm(o) === norm(s));
    return option ? { value: option } : { error: "not_an_option" };
  }
  return { value: s };
}

export function parseRow(columns: readonly ImportColumn[], raw: Record<string, unknown>) {
  const values: ImportValues = {};
  const errors: { column: string; code: ImportErrorCode }[] = [];
  for (const col of columns) {
    const cell = parseCell(col, raw[col.key]);
    if ("error" in cell) errors.push({ column: col.key, code: cell.error });
    values[col.key] = "error" in cell ? null : cell.value;
  }
  return { values, errors };
}

const same = (col: ImportColumn, a: ImportCell, b: ImportCell) =>
  col.type === "ref" ? norm(a) === norm(b) : a === b;

/** Keys whose file value differs from the existing row. An empty file cell is never a difference. */
export const diffValues = (
  columns: readonly ImportColumn[],
  file: ImportValues,
  target: ImportValues,
) =>
  columns
    .filter((c) => file[c.key] != null && !same(c, file[c.key] ?? null, target[c.key] ?? null))
    .map((c) => c.key);

/** The values an update writes: the differences, or under `fill` only those the row lacks. */
export function mergeValues(
  columns: readonly ImportColumn[],
  policy: MergePolicy,
  file: ImportValues,
  target: ImportValues,
): ImportValues {
  const keys = diffValues(columns, file, target).filter(
    (k) => policy === "overwrite" || target[k] == null,
  );
  return Object.fromEntries(keys.map((k) => [k, file[k] ?? null]));
}

/** A row's status and suggested action from what the entity's matcher found. Never guesses. */
export function suggest(
  columns: readonly ImportColumn[],
  row: { values: ImportValues; errors: unknown[] },
  match: { candidates: string[]; target: ImportValues | null },
): { status: ImportStatus; action: ImportAction } {
  if (row.errors.length) return { status: "invalid", action: "skip" };
  if (!match.candidates.length) return { status: "new", action: "create" };
  if (!match.target) return { status: "ambiguous", action: "skip" };
  return diffValues(columns, row.values, match.target).length
    ? { status: "changed", action: "update" }
    : { status: "identical", action: "skip" };
}

/**
 * What a run with nobody watching does with a row from an integration. It takes a `new` row and a
 * `changed` one that is `linked` to its source (imported from it before), unless the row needs a
 * person (`held`: it would add a brand, or no single profile fits). `optional` rows are only ever
 * offered, never waiting. Undefined = nothing to do.
 */
export function autoOf(r: {
  status: ImportStatus;
  linked: boolean;
  held: boolean;
  optional: boolean;
}): "apply" | "wait" | undefined {
  if (r.optional || r.status === "invalid" || r.status === "identical") return undefined;
  const known = r.status === "new" || (r.status === "changed" && r.linked);
  return known && !r.held ? "apply" : "wait";
}

/** The decisions of a run with nobody watching: every `apply` row takes its suggestion. */
export const autoDecisions = (rows: ImportPreviewRow[]): ImportApplyDecision[] =>
  rows.flatMap((r) =>
    r.auto === "apply" && r.action !== "skip"
      ? [
          {
            row: r.row,
            action: r.action,
            targetId: r.targetId ?? undefined,
            refs: Object.fromEntries(
              Object.entries(r.refs ?? {}).flatMap(([k, v]) => (v ? [[k, v]] : [])),
            ),
          },
        ]
      : [],
  );

/** What the user decided for a row. `policy` overrides the bulk merge policy. */
export type ImportDecision = {
  action: ImportAction;
  targetId: string | null;
  policy?: MergePolicy;
  /** By column key: the picked references. */
  refs?: Record<string, string | null>;
};

export const BULK_ACTIONS = [
  "autoMatch",
  "allNew",
  "onlyNew",
  "onlyChanged",
  "updateMatched",
  "skipAll",
  "reset",
] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** The decision a row starts with: the server's suggestion. */
export const suggested = (r: ImportPreviewRow): ImportDecision => ({
  action: r.action,
  targetId: r.targetId,
  refs: r.refs,
});

/**
 * Applies a bulk action to `rows` (all, the selected or the filtered ones) and returns the new
 * decisions by row number. Invalid rows never change. A target is the suggested one or one the
 * user picked; only `reset` drops a picked target.
 */
export function applyBulk(
  rows: ImportPreviewRow[],
  decisions: Record<number, ImportDecision>,
  bulk: BulkAction,
): Record<number, ImportDecision> {
  const next = { ...decisions };
  for (const r of rows) {
    if (r.status === "invalid") continue;
    const d = decisions[r.row] ?? suggested(r);
    if (bulk === "reset") {
      delete next[r.row];
      continue;
    }
    const matched = d.targetId !== null;
    const untouched = r.status === "identical" && d.targetId === r.targetId;
    const actions: Record<Exclude<BulkAction, "reset">, ImportAction> = {
      allNew: "create",
      autoMatch: matched ? (untouched ? "skip" : "update") : r.status === "new" ? "create" : "skip",
      onlyNew: r.status === "new" ? "create" : "skip",
      onlyChanged: r.status === "changed" && matched ? "update" : "skip",
      updateMatched: matched ? "update" : "skip",
      skipAll: "skip",
    };
    next[r.row] = { ...d, action: actions[bulk] };
  }
  return next;
}
