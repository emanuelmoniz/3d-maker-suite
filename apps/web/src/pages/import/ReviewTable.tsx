import {
  applyBulk,
  BULK_ACTIONS,
  type BulkAction,
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
  MERGE_POLICIES,
  type MergePolicy,
  mergeValues,
  PRINT_MAX_SLOTS,
  printSlotKeys,
  type ReviewEntity,
  suggested,
  usableOn,
} from "@3d-maker-suite/core";
import { FileSpreadsheet } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMoney } from "../../lib/cost.ts";
import { cx } from "../../lib/cx.ts";
import { spoolName, useProfiles } from "../../lib/filament.ts";
import { formatDate, formatDateTime, formatNumber, formatWeight } from "../../lib/format.ts";
import { useApply } from "../../lib/import.ts";
import { NewSpoolDialog } from "../filament/NewSpoolDialog.tsx";

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
const BULK: Record<BulkAction, string> = {
  autoMatch: "import:bulk.autoMatch",
  allNew: "import:bulk.allNew",
  onlyNew: "import:bulk.onlyNew",
  onlyChanged: "import:bulk.onlyChanged",
  updateMatched: "import:bulk.updateMatched",
  skipAll: "import:bulk.skipAll",
  reset: "import:bulk.reset",
};
const POLICIES: Record<MergePolicy, string> = {
  overwrite: "import:policies.overwrite",
  fill: "import:policies.fill",
};
const ERRORS: Record<ImportErrorCode, string> = {
  required: "import:errors.required",
  not_a_number: "import:errors.not_a_number",
  negative: "import:errors.negative",
  not_a_date: "import:errors.not_a_date",
  not_a_datetime: "import:errors.not_a_datetime",
  not_a_color: "import:errors.not_a_color",
  not_an_option: "import:errors.not_an_option",
  unresolved: "import:errors.unresolved",
  not_opened: "import:errors.not_opened",
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
  brand: "import:options.brand",
  material: "import:options.material",
  yes: "import:options.yes",
  no: "import:options.no",
};
const SCOPES = ["all", "selected", "filtered"] as const;
const SCOPE_LABELS: Record<(typeof SCOPES)[number], string> = {
  all: "import:scopes.all",
  selected: "import:scopes.selected",
  filtered: "import:scopes.filtered",
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
// The table renders this many rows at a time, so a file with thousands of rows stays quick.
const PAGE_ROWS = 100;
const ALL_TARGETS = "__all";
const NEW_SPOOL = "__new";
const TRACK = "trackUsage";
/**
 * What a print's slot says about its filament, for a spool added from its picker: a file names a
 * profile, an integration reports material and colour ("PLA #ff8800").
 */
const slotFilament = (r: ImportPreviewRow, spoolKey: string) => {
  const n = Array.from({ length: PRINT_MAX_SLOTS }, (_, i) => i + 1).find(
    (i) => printSlotKeys(i).spool === spoolKey,
  );
  const filament = n ? String(r.values[printSlotKeys(n).filament] ?? "") : "";
  return { filament, colorHex: /#[0-9a-f]{6}\b/i.exec(filament)?.[0].toLowerCase() };
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
  const [policy, setPolicy] = useState<MergePolicy>("overwrite");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState<Set<ImportStatus>>(new Set());
  // Rows whose target picker lists every existing row, not just the ones that fit.
  const [wide, setWide] = useState<Set<number>>(new Set());
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("all");
  const [bulk, setBulk] = useState<BulkAction>("autoMatch");
  const [confirming, setConfirming] = useState(false);
  const [page, setPage] = useState(0);
  // The spool picker a new spool is being added for, and the spools added so far.
  const [adding, setAdding] = useState<{ row: ImportPreviewRow; key: string } | null>(null);
  const [added, setAdded] = useState<NonNullable<ImportPreview["refOptions"]>[string]>([]);
  const profiles = useProfiles().data?.items ?? [];

  const { rows } = preview;
  const targets = new Map(preview.targets.map((x) => [x.id, x]));
  const decisionOf = (r: ImportPreviewRow) => decisions[r.row] ?? suggested(r);
  // A print takes its filament from the spools unless the row says "no" or the user unticks it.
  const tracks = (r: ImportPreviewRow) => decisionOf(r).trackUsage ?? r.values[TRACK] !== "no";
  const decide = (r: ImportPreviewRow, patch: Partial<ImportDecision>) =>
    setDecisions((d) => ({ ...d, [r.row]: { ...(d[r.row] ?? suggested(r)), ...patch } }));
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (!next.delete(v)) next.add(v);
    return next;
  };

  const visible = shown.size ? rows.filter((r) => shown.has(r.status)) : rows;
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_ROWS));
  const pageAt = Math.min(page, pages - 1);
  const pageRows = visible.slice(pageAt * PAGE_ROWS, (pageAt + 1) * PAGE_ROWS);
  const inScope = {
    all: rows,
    selected: rows.filter((r) => selected.has(r.row)),
    filtered: visible,
  };
  const updates = rows.filter((r) => decisionOf(r).action === "update");
  const pickedCount = new Map<string | null, number>();
  for (const r of updates) {
    const id = decisionOf(r).targetId;
    pickedCount.set(id, (pickedCount.get(id) ?? 0) + 1);
  }
  // References the user picks (a spool's filament profile, a print's project and spools) instead
  // of having them created: the ones the row's suggestion names. Optional ones (a print's spools)
  // may stay empty; any other is needed to create the row.
  const picked = Object.keys(preview.refOptions ?? {});
  const optional = new Set(preview.refsOptional);
  const picks = (r: ImportPreviewRow) => picked.filter((k) => r.refs && k in r.refs);
  const missingPick = (r: ImportPreviewRow, k: string) =>
    !optional.has(k) && !decisionOf(r).refs?.[k];
  // A row's options: the ones that fit it first. A spool opened after the print started, or
  // empty, is only listed when it is the pick already.
  const optionsFor = (r: ImportPreviewRow, key: string, current: string | null | undefined) => {
    const first = new Set(r.refsFirst?.[key]);
    const started = String(r.values.startedAt ?? "");
    return [...(preview.refOptions?.[key] ?? []), ...added]
      .filter(
        (o) =>
          o.id === current ||
          (!o.empty && (!started || usableOn({ openedAt: o.from ?? null }, started))),
      )
      .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)));
  };
  // An update needs a row to go to, and two file rows can't go to the same one; a new row needs
  // its required picks.
  const problem = (r: ImportPreviewRow) => {
    const d = decisionOf(r);
    if (d.action === "create")
      return picks(r).some((k) => missingPick(r, k)) ? t("import:review.needsRef") : null;
    if (d.action !== "update") return null;
    if (!d.targetId) return t("import:review.needsTarget");
    return (pickedCount.get(d.targetId) ?? 0) > 1 ? t("import:review.duplicateTarget") : null;
  };
  const count = (a: ImportAction) => rows.filter((r) => decisionOf(r).action === a).length;
  const invalid = rows.filter((r) => r.status === "invalid").length;
  const importing = count("create") + count("update");
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
  const inUse = (c: ImportColumn) =>
    c.key === TRACK ||
    !(c.labelArgs || c.fileOnly) ||
    rows.some(
      (r) =>
        r.values[c.key] != null ||
        r.errors.some((e) => e.column === c.key) ||
        r.candidates.some((id) => targets.get(id)?.values[c.key] != null),
    );
  const targetLabel = (x: ImportTarget) =>
    [x.label, ...(TARGET_DETAILS[entity]?.(x.values) ?? [])].filter(Boolean).join(" · ");

  // "Select all" works on the rows the status filter shows, on every page.
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
    {
      id: "row",
      header: t("import:review.row"),
      numeric: true,
      cell: (r) => r.row,
      sortValue: (r) => r.row,
    },
    {
      id: "status",
      header: t("import:review.status"),
      cell: (r) => (
        <span className={cx("font-medium", r.status === "invalid" && "text-bad")}>
          {t(STATUSES[r.status])}
        </span>
      ),
      sortValue: (r) => IMPORT_STATUSES.indexOf(r.status),
    },
    {
      id: "action",
      header: t("import:review.action"),
      cell: (r) => (
        <select
          aria-label={t("import:review.actionFor", { row: r.row })}
          className={selectClass}
          disabled={r.status === "invalid"}
          value={decisionOf(r).action}
          onChange={(e) => decide(r, { action: e.target.value as ImportAction })}
        >
          {IMPORT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(ACTIONS[a])}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: "target",
      header: t("import:review.target"),
      cell: (r) => {
        const d = decisionOf(r);
        if (d.action !== "update") return "";
        const all = wide.has(r.row) || !r.candidates.length;
        const options = all
          ? preview.targets
          : preview.targets.filter((x) => r.candidates.includes(x.id) || x.id === d.targetId);
        const issue = problem(r);
        return (
          <span className="flex items-center gap-2">
            <select
              aria-label={t("import:review.targetFor", { row: r.row })}
              aria-invalid={issue ? true : undefined}
              className={`${selectClass} max-w-72`}
              value={d.targetId ?? ""}
              onChange={(e) =>
                e.target.value === ALL_TARGETS
                  ? setWide((w) => toggle(w, r.row))
                  : decide(r, { targetId: e.target.value || null })
              }
            >
              <option value="">{t("import:review.pickTarget")}</option>
              {options.map((x) => (
                <option key={x.id} value={x.id}>
                  {targetLabel(x)}
                </option>
              ))}
              {!all && <option value={ALL_TARGETS}>{t("import:review.otherTarget")}</option>}
            </select>
            {issue && <span className="text-bad">{issue}</span>}
          </span>
        );
      },
    },
    {
      id: "policy",
      header: t("import:review.policy"),
      cell: (r) => {
        const d = decisionOf(r);
        return d.action !== "update" ? (
          ""
        ) : (
          <select
            aria-label={t("import:review.policyFor", { row: r.row })}
            className={selectClass}
            value={d.policy ?? ""}
            onChange={(e) =>
              decide(r, { policy: (e.target.value || undefined) as MergePolicy | undefined })
            }
          >
            <option value="">{t("import:review.policyDefault")}</option>
            {MERGE_POLICIES.map((p) => (
              <option key={p} value={p}>
                {t(POLICIES[p])}
              </option>
            ))}
          </select>
        );
      },
    },
    ...columns.filter(inUse).map(
      (c): Column<ImportPreviewRow> => ({
        id: c.key,
        header: t(c.label, c.labelArgs),
        numeric: c.type === "number" || c.type === "integer" || c.type === "money",
        cell: (r) => {
          const error = r.errors.find((e) => e.column === c.key);
          if (error) return <span className="text-bad">{t(ERRORS[error.code])}</span>;
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
          const value = format(c, r.values[c.key]);
          const options = preview.refOptions?.[c.key];
          // A suggestion picked from several, until the user picks another.
          const unsure =
            !!d.refs?.[c.key] &&
            d.refs[c.key] === r.refs?.[c.key] &&
            !!r.refsUnsure?.includes(c.key);
          if (options && d.action === "create" && picks(r).includes(c.key))
            return (
              <span className="flex items-center gap-2">
                {/* An optional pick names the row's own value, so the select replaces it. */}
                {!optional.has(c.key) && value}
                <select
                  aria-label={t("import:review.refFor", {
                    column: t(c.label, c.labelArgs),
                    row: r.row,
                  })}
                  aria-invalid={missingPick(r, c.key) || undefined}
                  className={cx(
                    `${selectClass} max-w-72`,
                    unsure && "border-warn ring-1 ring-warn",
                  )}
                  value={d.refs?.[c.key] ?? ""}
                  onChange={(e) =>
                    e.target.value === NEW_SPOOL
                      ? setAdding({ row: r, key: c.key })
                      : decide(r, { refs: { ...d.refs, [c.key]: e.target.value || null } })
                  }
                >
                  <option value="">{t("import:review.pickTarget")}</option>
                  {optionsFor(r, c.key, d.refs?.[c.key]).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                  {c.ref === "spools" && (
                    <option value={NEW_SPOOL}>{t("import:review.addSpool")}</option>
                  )}
                </select>
                {!d.refs?.[c.key] && (
                  <span className={optional.has(c.key) ? "text-warn" : "text-bad"}>
                    {t(optional.has(c.key) ? "import:review.noSpool" : "import:review.needsRef")}
                  </span>
                )}
                {unsure && <span className="text-warn">{t("import:review.checkSpool")}</span>}
              </span>
            );
          if (!target) return value;
          // What this update writes: the old value struck out, the new one next to it.
          const writes = mergeValues(columns, d.policy ?? policy, r.values, target.values);
          return c.key in writes ? (
            <span className="inline-flex items-center gap-2">
              {target.values[c.key] != null && (
                <del className="text-muted">{format(c, target.values[c.key])}</del>
              )}
              <ins className="font-medium text-accent no-underline">{value}</ins>
            </span>
          ) : (
            <span className="text-muted">{format(c, target.values[c.key])}</span>
          );
        },
      }),
    ),
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
              setPage(0);
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

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">{t("import:review.scope")}</span>
          <select
            className={selectClass}
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(SCOPE_LABELS[s], { count: inScope[s].length })}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">{t("import:review.bulk")}</span>
          <select
            className={selectClass}
            value={bulk}
            onChange={(e) => setBulk(e.target.value as BulkAction)}
          >
            {BULK_ACTIONS.map((b) => (
              <option key={b} value={b}>
                {t(BULK[b])}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={!inScope[scope].length}
          onClick={() => setDecisions((d) => applyBulk(inScope[scope], d, bulk))}
        >
          {t("common:table.apply")}
        </Button>
        <label className="flex flex-col gap-1.5 sm:ml-auto">
          <span className="font-medium">{t("import:review.policyBulk")}</span>
          <select
            className={selectClass}
            value={policy}
            onChange={(e) => setPolicy(e.target.value as MergePolicy)}
          >
            {MERGE_POLICIES.map((p) => (
              <option key={p} value={p}>
                {t(POLICIES[p])}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DataTable
        label={t("import:review.title")}
        columns={table}
        rows={pageRows}
        rowKey={(r) => String(r.row)}
      />
      {pages > 1 && (
        <nav
          aria-label={t("common:table.pagination")}
          className="flex items-center justify-end gap-3 text-muted"
        >
          <span aria-live="polite">
            {t("common:table.range", {
              from: pageAt * PAGE_ROWS + 1,
              to: Math.min((pageAt + 1) * PAGE_ROWS, visible.length),
              total: visible.length,
            })}
          </span>
          <Button variant="ghost" disabled={pageAt <= 0} onClick={() => setPage(pageAt - 1)}>
            {t("common:table.previous")}
          </Button>
          <Button
            variant="ghost"
            disabled={pageAt >= pages - 1}
            onClick={() => setPage(pageAt + 1)}
          >
            {t("common:table.next")}
          </Button>
        </nav>
      )}

      <dl className="flex flex-wrap gap-x-6 gap-y-1" aria-live="polite">
        {(
          [
            [t(ACTIONS.create), count("create")],
            [t(ACTIONS.update), count("update")],
            [t(ACTIONS.skip), count("skip") - invalid],
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
        <Button variant="ghost" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
      </div>
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
                        policy: d.policy,
                        ...(entity === "prints" && { trackUsage: tracks(r) }),
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
        open={adding && slotFilament(adding.row, adding.key)}
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
          decide(row, { refs: { ...decisionOf(row).refs, [key]: s.id } });
        }}
      />
    </section>
  );
}
