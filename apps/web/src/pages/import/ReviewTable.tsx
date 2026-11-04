import {
  type BulkForm,
  type BulkOutcome,
  bulkEdit,
  cellOf,
  folderOf,
  IMPORT_ACTIONS,
  IMPORT_COLUMNS,
  IMPORT_STATUSES,
  type ImportAction,
  type ImportCell,
  type ImportColumn,
  type ImportDecision,
  type ImportErrorCode,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportResult,
  type ImportStatus,
  type ImportTarget,
  type ImportValues,
  isBroken,
  missingPick as isMissingPick,
  mergeValues,
  NO_PROJECT,
  PRINT_MAX_SLOTS,
  pickOptions,
  picksOf,
  printSlotKeys,
  type ReviewEntity,
  type RowProblem,
  rowProblem,
  slotOf,
  suggested,
  targetUses,
  writePick,
} from "@3d-maker-suite/core";
import { FileSpreadsheet, Lock, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import {
  type Column,
  DataTable,
  filtersOf,
  type ListQuery,
  viewOf,
} from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { SelectionBar } from "../../components/SelectionBar.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMoney } from "../../lib/cost.ts";
import { cx } from "../../lib/cx.ts";
import { spoolName, useProfiles } from "../../lib/filament.ts";
import { formatDate, formatDateTime, formatNumber, formatWeight } from "../../lib/format.ts";
import { useApply } from "../../lib/import.ts";
import { useRoots } from "../../lib/roots.ts";
import { NewSpoolDialog } from "../filament/NewSpoolDialog.tsx";
import { BulkEditDialog } from "./BulkEditDialog.tsx";
import { cellText, EditCell } from "./EditCell.tsx";
import { FolderCell, PrintsCell, useProjectPrints } from "./ProjectCells.tsx";
import { skippedCount } from "./skipCount.ts";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const STATUSES: Record<ImportStatus, string> = {
  new: "import:statuses.new",
  identical: "import:statuses.identical",
  changed: "import:statuses.changed",
  ambiguous: "import:statuses.ambiguous",
  invalid: "import:statuses.invalid",
};
const ACTIONS: Record<ImportAction, string> = {
  create: "import:actions.create",
  update: "import:actions.update",
  skip: "import:actions.skip",
};
// What a bulk edit did and why the rest wasn't, in this order. Only `done` isn't a problem.
const RESULTS: [BulkOutcome, string, string?][] = [
  ["done", "import:edit.result.done"],
  ["noMatch", "import:edit.result.noMatch", "text-bad"],
  ["broken", "import:edit.result.broken", "text-bad"],
  ["needsRef", "import:edit.result.needsRef", "text-bad"],
  ["duplicate", "import:edit.result.duplicate", "text-bad"],
  ["noFit", "import:edit.result.noFit", "text-warn"],
  ["onSkip", "import:edit.result.onSkip", "text-warn"],
];
const ERRORS: Record<ImportErrorCode, string> = {
  required: "import:errors.required",
  not_a_number: "import:errors.not_a_number",
  negative: "import:errors.negative",
  not_a_date: "import:errors.not_a_date",
  not_a_datetime: "import:errors.not_a_datetime",
  not_a_color: "import:errors.not_a_color",
  not_an_option: "import:errors.not_an_option",
  not_an_email: "import:errors.not_an_email",
  unresolved: "import:errors.unresolved",
  not_opened: "import:errors.not_opened",
  before_install: "import:errors.before_install",
  overlap: "import:errors.overlap",
  wrong_target: "import:errors.wrong_target",
  outside_roots: "import:errors.outside_roots",
  folder_in_use: "import:errors.folder_in_use",
};
const PROBLEMS: Record<RowProblem, string> = {
  broken: "import:review.fixCells",
  needsRef: "import:review.needsRef",
  needsTarget: "import:review.needsTarget",
  duplicate: "import:review.duplicateTarget",
};
const MISSING: Record<string, string> = {
  filamentBrands: "import:missing.filamentBrands",
  filamentMaterials: "import:missing.filamentMaterials",
  filamentProfiles: "import:missing.filamentProfiles",
  brands: "import:missing.brands",
  printerModels: "import:missing.printerModels",
  projects: "import:missing.projects",
};
// Values of the columns that aren't typed by the user but named by the app.
const OPTIONS: Record<string, string> = {
  yes: "import:options.yes",
  no: "import:options.no",
  printer: "import:options.printer",
  accessory: "import:options.accessory",
};

/** What tells two rows with the same name apart in the target picker. */
const TARGET_DETAILS: Partial<Record<ReviewEntity, (v: ImportValues) => ImportCell[]>> = {
  spools: (v) => [
    v.colorHex ?? null,
    typeof v.remainingGrams === "number" ? formatWeight(v.remainingGrams) : null,
    v.location ?? null,
  ],
  printers: (v) => [v.serial ?? null],
  prints: (v) => [
    typeof v.startedAt === "string" ? formatDateTime(v.startedAt) : null,
    v.printer ?? null,
  ],
};
const ALL_TARGETS = "__all";
const NEW_SPOOL = "__new";
const TRACK = "trackUsage";
/**
 * What a print's slot says about its filament, for a spool added from its picker: a file names a
 * profile, an integration reports material and colour ("PLA #ff8800"). The row's cells first,
 * then the print it updates (one you have). The spool was open by the time the print started.
 */
const slotFilament = (r: ImportPreviewRow, spoolKey: string, target?: ImportTarget) => {
  const n = slotOf(spoolKey);
  const of = (k: string) => r.values[k] ?? target?.values[k] ?? null;
  const filament = n ? String(of(printSlotKeys(n).filament) ?? "") : "";
  const started = of("startedAt");
  return {
    filament,
    colorHex: /#[0-9a-f]{6}\b/i.exec(filament)?.[0].toLowerCase(),
    openedAt: typeof started === "string" ? started : undefined,
  };
};
const selectClass = `${inputClass} w-auto! min-w-28`;

export function ReviewTable({
  entity,
  preview,
  onDone,
  onCancel,
}: {
  entity: ReviewEntity;
  preview: ImportPreview;
  onDone: (result: ImportResult) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const apply = useApply(entity);
  const columns: readonly ImportColumn[] = IMPORT_COLUMNS[entity];
  const [decisions, setDecisions] = useState<Record<number, ImportDecision>>({});
  // Columns on Don't change: a file overwrites, an integration follows its sync type's choice.
  const policy = preview.policy ?? "overwrite";
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState<Set<ImportStatus>>(new Set());
  // Rows whose target picker lists every existing row, not just the ones that fit.
  const [wide, setWide] = useState<Set<number>>(new Set());
  // Each opening is a new form; the dialog stays mounted so closing returns the focus.
  const [editing, setEditing] = useState({ open: false, run: 0 });
  const [result, setResult] = useState<Partial<Record<BulkOutcome, number>> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dismissHint = useId();
  const [tableQuery, setTableQuery] = useState<ListQuery>({});
  // The spool picker a new spool is being added for, and the spools added so far.
  const [adding, setAdding] = useState<{ row: ImportPreviewRow; key: string } | null>(null);
  const [added, setAdded] = useState<NonNullable<ImportPreview["refOptions"]>[string]>([]);
  const profiles = useProfiles().data?.items ?? [];
  // Cells edited in the review, by row, as a file cell would hold them.
  const [edits, setEdits] = useState<Record<number, ImportValues>>({});

  const { rows } = preview;
  const targets = new Map(preview.targets.map((x) => [x.id, x]));
  const decisionOf = (r: ImportPreviewRow) => decisions[r.row] ?? suggested(r);
  /** A cell now, or the value of the row it updates when the row has none. */
  const valueNow = (r: ImportPreviewRow, key: string, target?: ImportTarget) => {
    const col = columns.find((c) => c.key === key);
    return (col && cellOf(r, col, edits[r.row]).value) ?? target?.values[key] ?? null;
  };
  const valuesOf = (r: ImportPreviewRow): ImportValues =>
    edits[r.row]
      ? Object.fromEntries(columns.map((c) => [c.key, cellOf(r, c, edits[r.row]).value]))
      : r.values;
  const broken = (r: ImportPreviewRow) => isBroken(r, columns, edits[r.row]);
  const editCell = (r: ImportPreviewRow, key: string, text: string | null | undefined) =>
    setEdits((all) => {
      const { [key]: _, ...rest } = all[r.row] ?? {};
      const row = text === undefined ? rest : { ...rest, [key]: text };
      const { [r.row]: __, ...others } = all;
      return Object.keys(row).length ? { ...others, [r.row]: row } : others;
    });
  // A print takes its filament from the spools unless the row says "no" or the user unticks it.
  const tracks = (r: ImportPreviewRow) => decisionOf(r).trackUsage ?? r.values[TRACK] !== "no";
  const decide = (r: ImportPreviewRow, patch: Partial<ImportDecision>) =>
    setDecisions((d) => ({ ...d, [r.row]: { ...(d[r.row] ?? suggested(r)), ...patch } }));
  const setCell = (
    r: ImportPreviewRow,
    key: string,
    pick: { id: string | null; label: string },
  ) => {
    const d = decisionOf(r);
    const target = d.action === "update" ? targets.get(d.targetId ?? "") : undefined;
    const next = writePick(r, key, pick, d, edits[r.row], target);
    decide(r, next.decision);
    if (next.edits) {
      const rowEdits = next.edits;
      setEdits((all) => ({ ...all, [r.row]: rowEdits }));
    }
  };
  const prints = entity === "prints";
  // Projects: a folder and the prints per row, besides the file's columns.
  const projects = entity === "projects";
  const roots = useRoots();
  const projectPrints = useProjectPrints(preview, projects);
  const decideFolder = (r: ImportPreviewRow, patch: Partial<ImportDecision>) => {
    const d = { ...decisionOf(r), ...patch };
    decide(r, patch);
    if (folderOf(r, decisionOf(r)) !== folderOf(r, d))
      void projectPrints.refresh({
        row: r.row,
        targetId: d.action === "update" ? d.targetId : null,
        folder: folderOf(r, d),
      });
  };
  const endSelection = () => {
    setSelected(new Set());
    setResult(null);
  };
  // Finished rows leave the selection; the ones that still need something stay, to go on with.
  const applyEdit = (form: BulkForm) => {
    const out = bulkEdit({
      preview,
      columns,
      shown: formColumns.map((c) => c.key),
      selected: [...selected],
      decisions,
      edits,
      added,
      form,
    });
    setDecisions(out.decisions);
    setEdits(out.edits);
    setSelected(new Set([...selected].filter((n) => out.report[n] !== "done")));
    const counts: Partial<Record<BulkOutcome, number>> = {};
    for (const o of Object.values(out.report)) counts[o] = (counts[o] ?? 0) + 1;
    setResult(counts);
    if (out.folders.length) void projectPrints.refresh(out.folders);
    setEditing((e) => ({ ...e, open: false }));
  };
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (!next.delete(v)) next.add(v);
    return next;
  };

  const byStatus = shown.size ? rows.filter((r) => shown.has(r.status)) : rows;
  const pickedCount = targetUses(rows, decisionOf);
  // References the user picks (a spool's filament profile, a print's project and spools) instead
  // of having them created: the ones the row's suggestion names.
  const picked = Object.keys(preview.refOptions ?? {});
  const optional = new Set(preview.refsOptional);
  const picks = (r: ImportPreviewRow) => picksOf(preview, r);
  const missingPick = (r: ImportPreviewRow, k: string) => isMissingPick(preview, decisionOf(r), k);
  const optionsFor = (r: ImportPreviewRow, key: string, current: string | null | undefined) =>
    pickOptions(preview, r, key, current, added);
  const problem = (r: ImportPreviewRow) => {
    const p = rowProblem(preview, columns, r, decisionOf(r), edits[r.row], pickedCount);
    return p && t(PROBLEMS[p]);
  };
  const count = (a: ImportAction) => rows.filter((r) => decisionOf(r).action === a).length;
  const invalid = rows.filter((r) => r.status === "invalid").length;
  const importing = count("create") + count("update");
  const waitingChanges = rows.filter((r) => r.auto === "wait" && r.status === "changed").length;
  const blocked = rows.some(problem);

  const format = (c: ImportColumn, v: ImportCell | undefined): ReactNode => {
    if (v == null) return "";
    if (c.type === "color")
      return (
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-4 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: String(v) }}
          />
          {v}
        </span>
      );
    if (c.type === "money") return money(Number(v));
    if (c.type === "date") return formatDate(`${v}T12:00:00Z`);
    if (c.type === "datetime") return formatDateTime(String(v));
    if (c.type === "enum" && OPTIONS[String(v)]) return t(OPTIONS[String(v)] ?? "");
    return typeof v === "number" ? formatNumber(v) : v;
  };
  // The numbered filament slots and the usage flag only show when the file or a matched row uses
  // them; a print's usage tick always shows.
  const has = (key: string) =>
    rows.some(
      (r) =>
        r.values[key] != null ||
        r.errors.some((e) => e.column === key) ||
        r.candidates.some((id) => targets.get(id)?.values[key] != null),
    );
  // A slot's spool and filament show whenever its grams do, so an empty one can be picked.
  const slotGrams = (key: string) => {
    const n = Array.from({ length: PRINT_MAX_SLOTS }, (_, i) => i + 1).find((i) =>
      Object.values(printSlotKeys(i)).includes(key),
    );
    return n ? printSlotKeys(n).grams : key;
  };
  const inUse = (c: ImportColumn) =>
    c.key === TRACK || !(c.labelArgs || c.fileOnly) || has(c.key) || has(slotGrams(c.key));
  // A file's columns in its order, plus what the review needs that it may not have: a print's
  // usage tick, a project's folder and the references a row picks.
  const fileKeys = preview.columns;
  const needed = (c: ImportColumn) =>
    (prints && c.key === TRACK) ||
    (projects && c.key === "folder") ||
    rows.some((r) => r.refs && c.key in r.refs);
  const shownColumns = fileKeys
    ? [
        ...fileKeys.flatMap((k) => columns.filter((c) => c.key === k)),
        ...columns.filter((c) => !fileKeys.includes(c.key) && needed(c)),
      ]
    : columns.filter(inUse);
  // A project's folder is not a cell: the bulk form has its own field for it.
  const formColumns = shownColumns.filter((c) => c.key !== "folder");
  const targetLabel = (x: ImportTarget) =>
    [
      x.label,
      ...(TARGET_DETAILS[entity]?.(x.values) ?? []),
      x.archived && t("import:review.archivedTarget"),
    ]
      .filter(Boolean)
      .join(" · ");

  const targetName = (r: ImportPreviewRow) => {
    const d = decisionOf(r);
    return d.action === "update" ? (targets.get(d.targetId ?? "")?.label ?? "") : "";
  };
  const dataColumns: Column<ImportPreviewRow>[] = [
    {
      id: "row",
      header: t("import:review.row"),
      numeric: true,
      cell: (r) => r.row,
      sortValue: (r) => r.row,
      filterValue: (r) => r.row,
    },
    {
      id: "status",
      header: t("import:review.status"),
      cell: (r) => (
        <>
          <span className={cx("font-medium", r.status === "invalid" && "text-bad")}>
            {t(STATUSES[r.status])}
          </span>
          {r.deleted && <span className="block text-muted">{t("import:review.deletedRow")}</span>}
        </>
      ),
      sortValue: (r) => IMPORT_STATUSES.indexOf(r.status),
    },
    {
      id: "action",
      header: t("import:review.action"),
      cell: (r) => (
        <Combobox
          aria-label={t("import:review.actionFor", { row: r.row })}
          className={selectClass}
          disabled={broken(r)}
          value={decisionOf(r).action}
          onChange={(v) => decide(r, { action: v as ImportAction })}
          options={IMPORT_ACTIONS.map((a) => ({ value: a, label: t(ACTIONS[a]) }))}
        />
      ),
      sortValue: (r) => IMPORT_ACTIONS.indexOf(decisionOf(r).action),
      filterValue: (r) => decisionOf(r).action,
      filterOptions: IMPORT_ACTIONS.map((a) => ({ value: a, label: t(ACTIONS[a]) })),
    },
    {
      id: "target",
      header: t("import:review.target"),
      cell: (r) => {
        const d = decisionOf(r);
        if (d.action !== "update") return "";
        const all = wide.has(r.row) || !r.candidates.length;
        // One you archived is only offered to the row that brought it back.
        const options = preview.targets.filter(
          (x) => r.candidates.includes(x.id) || x.id === d.targetId || (all && !x.archived),
        );
        const issue = problem(r);
        return (
          <span className="flex items-center gap-2">
            <Combobox
              aria-label={t("import:review.targetFor", { row: r.row })}
              aria-invalid={issue ? true : undefined}
              className={`${selectClass} max-w-72`}
              value={d.targetId ?? ""}
              onChange={(v) =>
                v === ALL_TARGETS
                  ? setWide((w) => toggle(w, r.row))
                  : decide(r, { targetId: v || null })
              }
              options={[
                { value: "", label: t("import:review.pickTarget") },
                ...options.map((x) => ({ value: x.id, label: targetLabel(x) })),
                ...(all ? [] : [{ value: ALL_TARGETS, label: t("import:review.otherTarget") }]),
              ]}
            />
            {issue && <span className="text-bad">{issue}</span>}
          </span>
        );
      },
      sortValue: targetName,
      filterValue: targetName,
    },
    ...(fileKeys?.includes("id")
      ? [
          {
            id: "id",
            header: t("import:review.id"),
            cell: (r: ImportPreviewRow) => {
              const id = String(r.raw.id ?? "");
              return (
                <span title={id} className="font-mono text-muted">
                  {id.slice(0, 8)}
                </span>
              );
            },
          },
        ]
      : []),
    ...shownColumns.map(
      (c): Column<ImportPreviewRow> => ({
        id: c.key,
        header: t(c.label, c.labelArgs),
        numeric: c.type === "number" || c.type === "integer" || c.type === "money",
        sortValue: (r) => cellOf(r, c, edits[r.row]).value ?? "",
        filterValue: (r) => cellOf(r, c, edits[r.row]).value ?? "",
        cell: (r) => {
          const d = decisionOf(r);
          if (c.key === TRACK)
            return d.action === "skip" ? (
              ""
            ) : (
              <input
                type="checkbox"
                aria-label={t("import:review.trackUsageFor", { row: r.row })}
                checked={tracks(r)}
                onChange={(e) => decide(r, { trackUsage: e.target.checked })}
              />
            );
          const target = d.action === "update" ? targets.get(d.targetId ?? "") : undefined;
          if (projects && c.key === "folder" && d.action !== "skip")
            return (
              <FolderCell
                row={r}
                decision={d}
                roots={roots}
                targetFolder={(target?.values.folder as string | null | undefined) ?? null}
                onChange={(patch) => decideFolder(r, patch)}
              />
            );
          const now = cellOf(r, c, edits[r.row]);
          const value = format(c, now.value);
          const options = preview.refOptions?.[c.key];
          // A suggestion picked from several, until the user picks another.
          const unsure =
            !!d.refs?.[c.key] &&
            d.refs[c.key] === r.refs?.[c.key] &&
            !!r.refsUnsure?.includes(c.key);
          const slot = prints && c.ref === "spools" ? slotOf(c.key) : undefined;
          // An update picks a slot's spool too; one with grams and no spool is a warning.
          if (
            slot &&
            options &&
            target &&
            Number(valueNow(r, printSlotKeys(slot).grams, target)) > 0
          ) {
            const label = String(valueNow(r, c.key, target) ?? "");
            const names = optionsFor(r, c.key, null).map((o) => o.label);
            return (
              <span className="flex items-center gap-2">
                <Combobox
                  aria-label={t("import:review.refFor", {
                    column: t(c.label, c.labelArgs),
                    row: r.row,
                  })}
                  className={cx(
                    `${selectClass} max-w-72`,
                    !label && "border-warn ring-1 ring-warn",
                  )}
                  value={label}
                  onChange={(v) =>
                    v === NEW_SPOOL
                      ? setAdding({ row: r, key: c.key })
                      : v &&
                        setCell(r, c.key, {
                          id: optionsFor(r, c.key, null).find((o) => o.label === v)?.id ?? null,
                          label: v,
                        })
                  }
                  options={[
                    ...(label ? [] : [{ value: "", label: t("import:review.pickTarget") }]),
                    ...(label && !names.includes(label) ? [label] : []).map((n) => ({
                      value: n,
                      label: n,
                    })),
                    ...names.map((n) => ({ value: n, label: n })),
                    { value: NEW_SPOOL, label: t("import:review.addSpool") },
                  ]}
                />
                {!label && <span className="text-warn">{t("import:review.noSpool")}</span>}
              </span>
            );
          }
          if (options && d.action === "create" && picks(r).includes(c.key))
            return (
              <span className="flex items-center gap-2">
                {/* An optional pick names the row's own value, so the picker replaces it. */}
                {!optional.has(c.key) && value}
                <Combobox
                  aria-label={t("import:review.refFor", {
                    column: t(c.label, c.labelArgs),
                    row: r.row,
                  })}
                  aria-invalid={missingPick(r, c.key) || undefined}
                  className={cx(
                    `${selectClass} max-w-72`,
                    (unsure || (optional.has(c.key) && !d.refs?.[c.key])) &&
                      "border-warn ring-1 ring-warn",
                  )}
                  value={d.refs?.[c.key] ?? ""}
                  onChange={(v) =>
                    v === NEW_SPOOL
                      ? setAdding({ row: r, key: c.key })
                      : setCell(r, c.key, { id: v || null, label: v })
                  }
                  options={[
                    { value: "", label: t("import:review.pickTarget") },
                    ...optionsFor(r, c.key, d.refs?.[c.key]).map((o) => ({
                      value: o.id,
                      label: o.id === NO_PROJECT ? t("import:review.noProject") : o.label,
                    })),
                    ...(c.ref === "spools"
                      ? [{ value: NEW_SPOOL, label: t("import:review.addSpool") }]
                      : []),
                  ]}
                />
                {!d.refs?.[c.key] && (
                  <span className={optional.has(c.key) ? "text-warn" : "text-bad"}>
                    {t(
                      optional.has(c.key)
                        ? "import:review.noSpool"
                        : c.key === "project"
                          ? "import:review.needsProject"
                          : "import:review.needsRef",
                    )}
                  </span>
                )}
                {unsure && <span className="text-warn">{t("import:review.checkSpool")}</span>}
              </span>
            );
          const edit = edits[r.row]?.[c.key];
          // A cell in error shows what the file (or the edit) says, to fix it.
          const shown = now.error ? String((now.edited ? edit : r.raw[c.key]) ?? "") : value;
          const editor = (view: ReactNode) =>
            // The number is the row an update writes to: it can't change.
            c.key === "number" && d.action === "update" ? (
              <span className="inline-flex items-center gap-1">
                {view}
                <Lock aria-hidden="true" className="size-3.5 text-muted" />
              </span>
            ) : (
              <EditCell
                col={c}
                label={t(c.label, c.labelArgs)}
                row={r.row}
                text={
                  now.edited
                    ? String(edit ?? "")
                    : now.error
                      ? String(r.raw[c.key] ?? "")
                      : cellText(c, now.value)
                }
                edited={now.edited}
                error={now.error && t(ERRORS[now.error])}
                names={c.ref ? preview.refNames[c.ref] : undefined}
                optionLabel={(o) => (OPTIONS[o] ? t(OPTIONS[o] ?? "") : o)}
                errorText={(code) => t(ERRORS[code])}
                onCommit={(text) => editCell(r, c.key, text)}
                onReset={() => editCell(r, c.key, undefined)}
              >
                {view}
              </EditCell>
            );
          if (!target || now.error) return editor(shown);
          // What this update writes: the old value struck out, the new one next to it.
          const writes = mergeValues(
            columns,
            policy,
            valuesOf(r),
            target.values,
            r.edited,
            d.columnPolicies,
          );
          return c.key in writes ? (
            <span className="inline-flex items-center gap-2">
              {target.values[c.key] != null && (
                <del className="text-muted">{format(c, target.values[c.key])}</del>
              )}
              {editor(<ins className="font-medium text-accent no-underline">{value}</ins>)}
            </span>
          ) : (
            editor(<span className="text-muted">{format(c, target.values[c.key])}</span>)
          );
        },
      }),
    ),
    ...(projects
      ? [
          {
            id: "prints",
            header: t("import:projects.printsColumn"),
            cell: (r: ImportPreviewRow) => {
              const d = decisionOf(r);
              return d.action === "skip" ? (
                ""
              ) : (
                <PrintsCell
                  row={r.row}
                  ids={d.prints ?? projectPrints.of(r.row)}
                  options={projectPrints.options}
                  onChange={(ids) => decide(r, { prints: ids })}
                />
              );
            },
          },
        ]
      : []),
  ];
  // Filters and sort cover every row, then it is paged: "select all" acts on the rows the status
  // chips and the column filters leave.
  const visible = viewOf(dataColumns, byStatus, tableQuery);
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.row));
  const someSelected = visible.some((r) => selected.has(r.row));
  const table: Column<ImportPreviewRow>[] = [
    {
      id: "select",
      header: "",
      headerCell: (
        <input
          type="checkbox"
          aria-label={t("import:review.selectAll", { count: visible.length })}
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected;
          }}
          onChange={() =>
            setSelected((s) => {
              const next = new Set(s);
              for (const r of visible) allSelected ? next.delete(r.row) : next.add(r.row);
              return next;
            })
          }
        />
      ),
      cell: (r) => (
        <input
          type="checkbox"
          aria-label={t("import:review.select", { row: r.row })}
          checked={selected.has(r.row)}
          onChange={() => setSelected((s) => toggle(s, r.row))}
        />
      ),
    },
    ...dataColumns,
  ];

  if (!rows.length)
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title={t("import:review.emptyTitle")}
        description={t("import:review.emptyBody")}
      />
    );

  return (
    <section aria-label={t("import:review.title")} className="grid gap-4">
      <h2 className="text-base font-semibold">{t("import:review.title")}</h2>
      {Object.entries(preview.missing).map(
        ([ref, names]) =>
          !!names.length &&
          MISSING[ref] && (
            <p key={ref} className="text-muted">
              {t(MISSING[ref], { names })}
            </p>
          ),
      )}
      {!!preview.ignoredHeaders.length && (
        <p className="text-muted">
          {t("import:review.ignored", { names: preview.ignoredHeaders })}
        </p>
      )}

      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t("import:review.filter")}</legend>
        {IMPORT_STATUSES.filter((s) => rows.some((r) => r.status === s)).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shown.has(s)}
            onClick={() => {
              setShown((f) => toggle(f, s));
              setTableQuery(({ page: _, ...q }) => q);
              endSelection();
            }}
            className="h-8 rounded-full border border-border px-3 hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            {t("import:review.statusCount", {
              status: t(STATUSES[s]),
              count: rows.filter((r) => r.status === s).length,
            })}
          </button>
        ))}
      </fieldset>

      {/* Sticks together, so both stay in sight on a long table. */}
      <div className={cx("sticky top-2 z-10 grid gap-2", !result && !selected.size && "hidden")}>
        <div
          className={cx(
            "flex items-start gap-2 rounded-lg border border-border bg-surface p-2 shadow-lg",
            !result && "hidden",
          )}
        >
          {/* Always there, so a screen reader announces what appears in it. */}
          <div role="status" className="grid min-w-0 flex-1 gap-1 py-1.5">
            {RESULTS.map(
              ([outcome, key, tone]) =>
                !!result?.[outcome] && (
                  <p key={outcome} className={tone}>
                    {t(key, { count: result[outcome] })}
                  </p>
                ),
            )}
          </div>
          {result && (
            <button
              type="button"
              aria-label={t("import:edit.dismiss")}
              title={t("import:edit.dismiss")}
              onClick={() => setResult(null)}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <SelectionBar count={selected.size} onClear={endSelection}>
          <Button
            onClick={() => {
              setResult(null);
              setEditing((e) => ({ open: true, run: e.run + 1 }));
            }}
          >
            {t("import:edit.open")}
          </Button>
        </SelectionBar>
      </div>

      <DataTable
        label={t("import:review.title")}
        columns={table}
        rows={byStatus}
        rowKey={(r) => String(r.row)}
        client={{
          query: tableQuery,
          onQueryChange: (q) => {
            if (filtersOf(q) !== filtersOf(tableQuery)) endSelection();
            setTableQuery(q);
          },
        }}
      />
      <BulkEditDialog
        key={editing.run}
        open={editing.open}
        preview={preview}
        columns={formColumns}
        selected={rows.filter((r) => selected.has(r.row)).map(decisionOf)}
        added={added}
        optionLabel={(o) => (OPTIONS[o] ? t(OPTIONS[o] ?? "") : o)}
        errorText={(code) => t(ERRORS[code])}
        onApply={applyEdit}
        onCancel={() => setEditing((e) => ({ ...e, open: false }))}
      />

      <dl className="flex flex-wrap gap-x-6 gap-y-1" aria-live="polite">
        {(
          [
            [t(ACTIONS.create), count("create")],
            [t(ACTIONS.update), count("update")],
            [
              t(ACTIONS.skip),
              skippedCount(rows.map((r) => ({ status: r.status, action: decisionOf(r).action }))),
            ],
            [t(STATUSES.invalid), invalid],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium">{formatNumber(n)}</dd>
          </div>
        ))}
      </dl>
      {apply.isError && (
        <p role="alert" className="text-bad">
          {t("import:review.error")}
          {apply.error instanceof ApiError && (
            <span className="block text-sm">
              {t("import:review.errorDetail", {
                detail: apply.error.detail ?? apply.error.message,
                code: apply.error.code ?? "",
              })}
            </span>
          )}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!importing || blocked || apply.isPending}
          onClick={() => setConfirming(true)}
        >
          {t("import:review.confirm", { count: importing })}
        </Button>
        {/* Changes a sync left for you, all skipped: confirming nothing marks them as seen. */}
        {!importing && waitingChanges > 0 && (
          <Button
            aria-describedby={dismissHint}
            disabled={apply.isPending}
            onClick={() =>
              apply.mutate(
                { uploadId: preview.uploadId, policy, decisions: [] },
                { onSuccess: onDone },
              )
            }
          >
            {t("import:review.dismiss", { count: waitingChanges })}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
      </div>
      {!importing && waitingChanges > 0 && (
        <p id={dismissHint} className="text-muted">
          {t("import:review.dismissHint")}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={t("import:review.confirmTitle", { count: importing })}
        description={t("import:review.confirmBody")}
        confirmLabel={t("import:review.confirm", { count: importing })}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          apply.mutate(
            {
              uploadId: preview.uploadId,
              policy,
              decisions: rows.flatMap((r) => {
                const d = decisionOf(r);
                return d.action === "skip"
                  ? []
                  : [
                      {
                        row: r.row,
                        action: d.action,
                        targetId: d.action === "update" ? (d.targetId ?? undefined) : undefined,
                        columnPolicies: d.columnPolicies,
                        values: edits[r.row],
                        ...(entity === "prints" && { trackUsage: tracks(r) }),
                        ...(projects && {
                          folder: d.folder,
                          fromFolder: d.fromFolder,
                          prints: d.prints,
                        }),
                        refs:
                          d.action === "create" && picked.length
                            ? Object.fromEntries(
                                picks(r).flatMap((k) =>
                                  // An optional pick left empty is left out.
                                  optional.has(k) && !d.refs?.[k] ? [] : [[k, d.refs?.[k] ?? ""]],
                                ),
                              )
                            : undefined,
                      },
                    ];
              }),
            },
            { onSuccess: onDone },
          );
        }}
      />
      <NewSpoolDialog
        open={
          adding &&
          slotFilament(
            adding.row,
            adding.key,
            targets.get(
              (decisionOf(adding.row).action === "update" && decisionOf(adding.row).targetId) || "",
            ),
          )
        }
        onClose={() => setAdding(null)}
        onSaved={(s) => {
          if (!adding) return;
          const label = spoolName(
            t,
            s,
            profiles.find((p) => p.id === s.profileId),
          );
          setAdded((a) => [...a, { id: s.id, label }]);
          const { row, key } = adding;
          setCell(row, key, { id: s.id, label });
        }}
      />
    </section>
  );
}
