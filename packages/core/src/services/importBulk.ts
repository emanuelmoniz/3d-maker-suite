import {
  type ImportAction,
  type ImportColumn,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportTarget,
  type ImportValues,
  type MergePolicy,
  NO_PROJECT,
  PRINT_MAX_SLOTS,
  printSlotKeys,
} from "../schemas/import.ts";
import { type ImportDecision, parseCell, suggested } from "./import.ts";
import { usableOn } from "./spoolMatch.ts";

type Preview = Pick<ImportPreview, "rows" | "targets" | "refOptions" | "refsOptional">;
type RefOption = NonNullable<ImportPreview["refOptions"]>[string][number];

const omit = <T>(from: Record<string, T> | undefined, key: string) => {
  const { [key]: _, ...rest } = from ?? {};
  return rest;
};

/** The slot of a print's spool column; undefined for any other column. */
export const slotOf = (key: string) =>
  Array.from({ length: PRINT_MAX_SLOTS }, (_, i) => i + 1).find(
    (i) => printSlotKeys(i).spool === key,
  );

/** The last folder of a path ("C:\x\001_vase" → "001_vase"); empty for a bare root. */
export const lastFolder = (path: string) =>
  path
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1) ?? "";

/** The folder `name` inside `root`, joined with the root's own separator. */
export const inRoot = (root: string, name: string) =>
  `${root.replace(/[\\/]+$/, "")}${root.includes("\\") ? "\\" : "/"}${name}`;

/** The folder a project row ends up with: the one picked in the review, else the file's. */
export const folderOf = (r: ImportPreviewRow, d: ImportDecision) =>
  d.folder === undefined
    ? typeof r.values.folder === "string"
      ? r.values.folder
      : null
    : d.folder && "path" in d.folder
      ? d.folder.path
      : null;

/** A row whose only error is its folder (outside the roots): a new folder fixes it. */
export const fixable = (r: ImportPreviewRow) =>
  r.status === "invalid" && r.errors.length > 0 && r.errors.every((e) => e.column === "folder");

/** A cell now: the file's value and error, or the edit read like a file cell. */
export const cellOf = (r: ImportPreviewRow, c: ImportColumn, rowEdits?: ImportValues) => {
  if (!rowEdits || !(c.key in rowEdits))
    return {
      value: r.values[c.key] ?? null,
      error: r.errors.find((x) => x.column === c.key)?.code,
      edited: false,
    };
  const p = parseCell(c, rowEdits[c.key]);
  return "error" in p
    ? { value: null, error: p.error, edited: true }
    : { value: p.value, error: undefined, edited: true };
};

// Server-only errors (a name that must exist) come back on apply once a cell is edited.
export const isBroken = (
  r: ImportPreviewRow,
  columns: readonly ImportColumn[],
  rowEdits?: ImportValues,
) => columns.some((c) => cellOf(r, c, rowEdits).error);

/** The references this row picks: the ones its suggestion names. */
export const picksOf = (preview: Pick<Preview, "refOptions">, r: ImportPreviewRow) =>
  Object.keys(preview.refOptions ?? {}).filter((k) => r.refs && k in r.refs);

/** Optional picks (a print's spools) may stay empty; any other is needed to create the row. */
export const missingPick = (
  preview: Pick<Preview, "refsOptional">,
  d: ImportDecision,
  key: string,
) => !preview.refsOptional?.includes(key) && !d.refs?.[key];

/**
 * A row's options: the ones that fit it first. A spool opened after the print started, or empty,
 * is only listed when it is the pick already. `added` spools only go to a spool column.
 */
export const pickOptions = (
  preview: Pick<Preview, "refOptions">,
  r: ImportPreviewRow,
  key: string,
  current: string | null | undefined,
  added: readonly RefOption[] = [],
) => {
  const first = new Set(r.refsFirst?.[key]);
  const started = String(r.values.startedAt ?? "");
  return [...(preview.refOptions?.[key] ?? []), ...(slotOf(key) ? added : [])]
    .filter(
      (o) =>
        o.id === current ||
        (!o.empty && (!started || usableOn({ openedAt: o.from ?? null }, started))),
    )
    .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)));
};

/** How many rows update each existing row. */
export function targetUses(
  rows: readonly ImportPreviewRow[],
  decisionOf: (r: ImportPreviewRow) => ImportDecision,
) {
  const uses = new Map<string | null, number>();
  for (const r of rows) {
    const d = decisionOf(r);
    if (d.action === "update") uses.set(d.targetId, (uses.get(d.targetId) ?? 0) + 1);
  }
  return uses;
}

export type RowProblem = "broken" | "needsRef" | "needsTarget" | "duplicate";

/**
 * What stops a row from importing. An update needs a row to go to, and two file rows can't go to
 * the same one; a new row needs its required picks.
 */
export function rowProblem(
  preview: Pick<Preview, "refOptions" | "refsOptional">,
  columns: readonly ImportColumn[],
  r: ImportPreviewRow,
  d: ImportDecision,
  rowEdits: ImportValues | undefined,
  uses: ReadonlyMap<string | null, number>,
): RowProblem | null {
  if (d.action !== "skip" && isBroken(r, columns, rowEdits)) return "broken";
  if (d.action === "create")
    return picksOf(preview, r).some((k) => missingPick(preview, d, k)) ? "needsRef" : null;
  if (d.action !== "update") return null;
  if (!d.targetId) return "needsTarget";
  return (uses.get(d.targetId) ?? 0) > 1 ? "duplicate" : null;
}

/**
 * The one way to write a picked cell. On an update it is a name edit of the cell, and a spool slot
 * without grams (a print you have) takes the print's, so the slot stays whole. Without a row to
 * update it is a ref id on the decision.
 */
export function writePick(
  r: ImportPreviewRow,
  key: string,
  pick: { id: string | null; label: string },
  d: ImportDecision,
  rowEdits: ImportValues | undefined,
  target: ImportTarget | undefined,
): { decision: ImportDecision; edits: ImportValues | undefined } {
  if (!target) return { decision: { ...d, refs: { ...d.refs, [key]: pick.id } }, edits: rowEdits };
  const slot = slotOf(key);
  const grams = slot && printSlotKeys(slot).grams;
  const copy = grams && r.values[grams] == null ? target.values[grams] : null;
  return {
    decision: d,
    edits: {
      ...rowEdits,
      [key]: pick.label,
      ...(grams && copy != null && { [grams]: String(copy) }),
    },
  };
}

export type BulkOption = "import" | "overwrite" | "keepEdits" | "empty" | "value";
export type BulkField =
  | { kind: "import" }
  | { kind: "overwrite" }
  | { kind: "keepEdits" }
  | { kind: "empty" }
  /** `text` as a file cell holds it; `id` = a picked reference. */
  | { kind: "value"; text: string; id?: string };

export type BulkForm = {
  /** `keep` = Don't change. */
  action: "keep" | "create" | "update" | "skip" | "suggestion";
  /** Update which: absent = Don't change. */
  target?: "system";
  /** All columns; a field in `fields` wins. */
  all?: "overwrite" | "keepEdits";
  /** By column key; absent = Don't change. */
  fields: Record<string, BulkField>;
  /** Projects: replaces the folder. `moveToRoot`: each row keeps its own last folder. */
  folder?:
    | { kind: "import" | "none" }
    | { kind: "path"; path: string }
    | { kind: "moveToRoot"; root: string }
    | { kind: "create"; name?: string; rootId?: string };
};

export type BulkOutcome =
  | "done"
  | "noMatch"
  | "noFit"
  | "onSkip"
  | "broken"
  | "needsRef"
  | "duplicate";
const OUTCOMES: Record<RowProblem, BulkOutcome> = {
  broken: "broken",
  needsRef: "needsRef",
  needsTarget: "noMatch",
  duplicate: "duplicate",
};

/** A column's merge policy; none = the row's. */
function withPolicy(d: ImportDecision, key: string, policy: MergePolicy | undefined | false) {
  if (!policy && !d.columnPolicies) return d;
  return {
    ...d,
    columnPolicies: policy ? { ...d.columnPolicies, [key]: policy } : omit(d.columnPolicies, key),
  };
}

/** What the form offers for a column, given the selected rows' decisions. */
export function bulkField(
  col: ImportColumn,
  {
    form,
    selected,
    preview,
  }: {
    form: BulkForm;
    selected: readonly ImportDecision[];
    preview: Pick<Preview, "refOptions" | "refsOptional">;
  },
): "hidden" | "readOnly" | "disabled" | BulkOption[] {
  if (col.perRow && selected.length > 1) return "hidden";
  // The number is the row an update writes to: it can't change.
  const updating =
    form.action === "update" ||
    (form.action === "keep" && selected.some((d) => d.action === "update"));
  const by = col.setBy && form.fields[col.setBy.column];
  if (
    (col.key === "number" && updating) ||
    (by?.kind === "value" && (col.setBy?.value === undefined || by.text === col.setBy.value)) ||
    (col.scanned && selected.some((d) => d.fromFolder))
  )
    return "readOnly";
  if (
    form.action === "skip" ||
    form.action === "suggestion" ||
    (form.action === "keep" && selected.every((d) => d.action === "skip"))
  )
    return "disabled";
  if (col.fileOnly) return ["import", "value"];
  if (form.action === "update") return ["overwrite", "keepEdits", "value"];
  if (form.action === "keep") return ["import", "value"];
  const pick = !!preview.refOptions && col.key in preview.refOptions;
  const optional = !col.required && (!pick || preview.refsOptional?.includes(col.key));
  return optional ? ["import", "value", "empty"] : ["import", "value"];
}

/**
 * The bulk form applied to the selected rows, values first so a value can fix an invalid row, then
 * the action. A row still broken doesn't change action, and one with no match takes no values.
 * Unselected rows never change.
 */
export function bulkEdit({
  preview,
  columns,
  shown,
  selected,
  decisions,
  edits,
  added = [],
  form,
}: {
  preview: Preview;
  columns: readonly ImportColumn[];
  /** The columns the table shows: what All columns covers. */
  shown: readonly string[];
  selected: readonly number[];
  decisions: Record<number, ImportDecision>;
  edits: Record<number, ImportValues>;
  /** Spools added in this review, offered like the picker offers them. */
  added?: readonly RefOption[];
  form: BulkForm;
}) {
  const targets = new Map(preview.targets.map((t) => [t.id, t]));
  const chosen = preview.rows.filter((r) => selected.includes(r.row));
  const before = (r: ImportPreviewRow) => decisions[r.row] ?? suggested(r);
  const ctx = { form, selected: chosen.map(before), preview };
  // The fields the form allows, each with what it asks. Picks last: a slot's spool needs its grams.
  const writes = columns
    .flatMap((col) => {
      const state = bulkField(col, ctx);
      const field: BulkField | undefined =
        form.fields[col.key] ??
        (form.all && shown.includes(col.key) ? { kind: form.all } : undefined);
      return field && Array.isArray(state) && state.includes(field.kind) ? [{ col, field }] : [];
    })
    .sort((a, b) => Number("id" in a.field) - Number("id" in b.field));
  const folder = form.action === "skip" || form.action === "suggestion" ? undefined : form.folder;

  const nextDecisions = { ...decisions };
  const nextEdits = { ...edits };
  const stuck = new Map<number, BulkOutcome>();
  const folders: { row: number; targetId: string | null; folder: string | null }[] = [];

  for (const r of chosen) {
    const was = before(r);
    const fix = !!folder && folder.kind !== "import" && fixable(r);
    if (form.action === "keep" && was.action === "skip" && !fix) {
      stuck.set(r.row, "onSkip");
      continue;
    }
    let e: ImportValues = edits[r.row] ?? {};
    // A row the edits fixed is a new one, or the update of the row it names. Edits stay, so the
    // overwrite that makes them count does too.
    const kept = Object.entries(was.columnPolicies ?? {}).filter(([k]) => k in e);
    let d: ImportDecision =
      form.action === "suggestion"
        ? { ...suggested(r), ...(kept.length && { columnPolicies: Object.fromEntries(kept) }) }
        : was;
    const action: ImportAction =
      form.action === "keep"
        ? was.action === "skip"
          ? "create"
          : was.action
        : form.action !== "suggestion"
          ? form.action
          : r.status !== "invalid" || isBroken(r, columns, e)
            ? r.action
            : r.targetId
              ? "update"
              : "create";
    if (action === "update" && form.target === "system")
      d = { ...d, targetId: r.targetId ?? d.targetId };
    const target = action === "update" ? targets.get(d.targetId ?? "") : undefined;
    const noMatch = action === "update" && !target;
    let noFit = false;

    for (const { col, field } of noMatch ? [] : writes) {
      const key = col.key;
      const isPick = !!r.refs && key in r.refs;
      if (col.fileOnly) {
        d = { ...d, trackUsage: field.kind === "value" ? field.text === "yes" : undefined };
      } else if (field.kind === "overwrite" || field.kind === "keepEdits") {
        e = omit(e, key);
        d = withPolicy(d, key, field.kind);
      } else if (field.kind === "import") {
        e = omit(e, key);
        if (isPick) d = { ...d, refs: { ...d.refs, [key]: r.refs?.[key] ?? null } };
        d = withPolicy(d, key, target && "overwrite");
      } else if (field.kind === "empty") {
        if (isPick) d = { ...d, refs: { ...d.refs, [key]: null } };
        else e = { ...e, [key]: null };
      } else if (field.id === undefined) {
        e = { ...e, [key]: field.text };
        d = withPolicy(d, key, target && "overwrite");
      } else {
        // A pick goes only where the row's own picker would take it. An empty cell never clears a
        // value, so No project can't go to an update; a slot needs grams for its spool.
        const slot = slotOf(key);
        const grams = slot && printSlotKeys(slot).grams;
        const gramsCol = grams && columns.find((c) => c.key === grams);
        const hasGrams =
          !gramsCol ||
          Number(cellOf(r, gramsCol, e).value ?? (grams && target?.values[grams]) ?? 0) > 0;
        const fits =
          pickOptions(preview, r, key, null, added).some((o) => o.id === field.id) &&
          hasGrams &&
          (target ? field.id !== NO_PROJECT : isPick || (!slot && field.id !== NO_PROJECT));
        if (!fits) {
          noFit = true;
        } else if (target || isPick) {
          const written = writePick(r, key, { id: field.id, label: field.text }, d, e, target);
          d = written.decision;
          e = written.edits ?? {};
          d = withPolicy(d, key, target && "overwrite");
        } else {
          e = { ...e, [key]: field.text };
        }
      }
    }

    if (folder && !noMatch) {
      const old = folderOf(r, was);
      const moved =
        folder.kind === "moveToRoot" && old && lastFolder(old)
          ? inRoot(folder.root, lastFolder(old))
          : null;
      if (folder.kind === "moveToRoot" && !moved) noFit = true;
      else if (folder.kind === "import") {
        d = { ...d, folder: undefined, fromFolder: undefined };
        e = omit(e, "folder");
      } else {
        const path = folder.kind === "path" ? folder.path : moved;
        d = {
          ...d,
          fromFolder: undefined,
          folder: path
            ? { path }
            : folder.kind === "create"
              ? { create: true, name: folder.name, rootId: folder.rootId }
              : null,
        };
        // Otherwise the row's old folder is still its error on the server.
        if (fix) e = { ...e, folder: path };
      }
    }

    // An update can't change the row's number: the server refuses it.
    const ending = action === "update" ? omit(e, "number") : e;
    const stays = isBroken(r, columns, ending) && !(was.action === "skip" && action === "skip");
    if (stays) stuck.set(r.row, "broken");
    else if (noFit) stuck.set(r.row, "noFit");
    const final: ImportDecision = {
      ...(stays && form.action === "suggestion" ? was : d),
      action: stays ? was.action : action,
    };
    const rowEdits = stays ? e : ending;
    nextDecisions[r.row] = final;
    if (Object.keys(rowEdits).length) nextEdits[r.row] = rowEdits;
    else delete nextEdits[r.row];
    if (folderOf(r, was) !== folderOf(r, final))
      folders.push({
        row: r.row,
        targetId: final.action === "update" ? final.targetId : null,
        folder: folderOf(r, final),
      });
  }

  const uses = targetUses(preview.rows, (r) => nextDecisions[r.row] ?? suggested(r));
  const report: Record<number, BulkOutcome> = {};
  for (const r of chosen) {
    const problem = rowProblem(
      preview,
      columns,
      r,
      nextDecisions[r.row] ?? suggested(r),
      nextEdits[r.row],
      uses,
    );
    report[r.row] = stuck.get(r.row) ?? (problem ? OUTCOMES[problem] : "done");
  }
  return { decisions: nextDecisions, edits: nextEdits, report, folders };
}
