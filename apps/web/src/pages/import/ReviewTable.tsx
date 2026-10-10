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
  type ImportEntity,
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
  suggested,
} from "@3d-maker-suite/core";
import { FileSpreadsheet } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { useMoney } from "../../lib/cost.ts";
import { cx } from "../../lib/cx.ts";
import { formatDate, formatNumber, formatWeight } from "../../lib/format.ts";
import { useApply } from "../../lib/import.ts";

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
  not_a_color: "import:errors.not_a_color",
  not_an_option: "import:errors.not_an_option",
};
const MISSING: Record<string, string> = {
  filamentBrands: "import:missing.filamentBrands",
  filamentMaterials: "import:missing.filamentMaterials",
  filamentProfiles: "import:missing.filamentProfiles",
};
const SCOPES = ["all", "selected", "filtered"] as const;
const SCOPE_LABELS: Record<(typeof SCOPES)[number], string> = {
  all: "import:scopes.all",
  selected: "import:scopes.selected",
  filtered: "import:scopes.filtered",
};

/** What tells two rows with the same name apart in the target picker. */
const TARGET_DETAILS: Record<ImportEntity, (v: ImportValues) => ImportCell[]> = {
  spools: (v) => [
    v.colorHex ?? null,
    typeof v.remainingGrams === "number" ? formatWeight(v.remainingGrams) : null,
    v.location ?? null,
  ],
};
const ALL_TARGETS = "__all";
const selectClass = `${inputClass} w-auto! min-w-28`;

export function ReviewTable({
  entity,
  preview,
  onDone,
  onCancel,
}: {
  entity: ImportEntity;
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

  const { rows } = preview;
  const targets = new Map(preview.targets.map((x) => [x.id, x]));
  const decisionOf = (r: ImportPreviewRow) => decisions[r.row] ?? suggested(r);
  const decide = (r: ImportPreviewRow, patch: Partial<ImportDecision>) =>
    setDecisions((d) => ({ ...d, [r.row]: { ...(d[r.row] ?? suggested(r)), ...patch } }));
  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (!next.delete(v)) next.add(v);
    return next;
  };

  const visible = shown.size ? rows.filter((r) => shown.has(r.status)) : rows;
  const inScope = {
    all: rows,
    selected: rows.filter((r) => selected.has(r.row)),
    filtered: visible,
  };
  const updates = rows.filter((r) => decisionOf(r).action === "update");
  const picked = updates.map((r) => decisionOf(r).targetId);
  // An update needs a row to go to, and two file rows can't go to the same one.
  const problem = (r: ImportPreviewRow) => {
    const d = decisionOf(r);
    if (d.action !== "update") return null;
    if (!d.targetId) return t("import:review.needsTarget");
    return picked.filter((id) => id === d.targetId).length > 1
      ? t("import:review.duplicateTarget")
      : null;
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
    return typeof v === "number" ? formatNumber(v) : v;
  };
  const targetLabel = (x: ImportTarget) =>
    [x.label, ...TARGET_DETAILS[entity](x.values)].filter(Boolean).join(" · ");

  const table: Column<ImportPreviewRow>[] = [
    {
      id: "select",
      header: "",
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
    ...columns.map(
      (c): Column<ImportPreviewRow> => ({
        id: c.key,
        header: t(c.label),
        numeric: c.type === "number" || c.type === "integer" || c.type === "money",
        cell: (r) => {
          const error = r.errors.find((e) => e.column === c.key);
          if (error) return <span className="text-bad">{t(ERRORS[error.code])}</span>;
          const d = decisionOf(r);
          const target = d.action === "update" ? targets.get(d.targetId ?? "") : undefined;
          const value = format(c, r.values[c.key]);
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
            onClick={() => setShown((f) => toggle(f, s))}
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
        rows={visible}
        rowKey={(r) => String(r.row)}
      />

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
                      },
                    ];
              }),
            },
            { onSuccess: onDone },
          );
        }}
      />
    </section>
  );
}
