import type { Stats, StatsMetrics } from "@3d-maker-suite/core";
import { ChartColumn, Download } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarSeries } from "../../components/BarSeries.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DataTable, type ListQuery } from "../../components/DataTable.tsx";
import { DateRangePicker } from "../../components/DateRangePicker.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { useMoney } from "../../lib/cost.ts";
import { spoolName, useProfiles, useSpools } from "../../lib/filament.ts";
import { formatDuration, formatEnergy, formatNumber, formatWeight } from "../../lib/format.ts";
import { printerName, usePrinters } from "../../lib/printers.ts";
import { projectName, useProjects } from "../../lib/projects.ts";
import { type StatsFilters, statsQs, useStats } from "../../lib/stats.ts";
import { useTags } from "../../lib/tags.ts";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const PRESETS = {
  "7": "stats:presets.7",
  "30": "stats:presets.30",
  "90": "stats:presets.90",
  "365": "stats:presets.365",
  all: "stats:presets.all",
  custom: "stats:presets.custom",
} as const;
const METRICS = {
  prints: "stats:series.metrics.prints",
  hours: "stats:series.metrics.hours",
  total: "stats:series.metrics.total",
} as const;
const BUCKETS = {
  day: "stats:series.buckets.day",
  week: "stats:series.buckets.week",
  month: "stats:series.buckets.month",
} as const;
const OUTCOMES = {
  success: "prints:outcomes.success",
  failed: "prints:outcomes.failed",
  cancelled: "prints:outcomes.cancelled",
} as const;
type Group = Stats["breakdowns"]["printer"][number];

const dayStr = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/** A filter with its name above it. */
function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex max-w-full flex-col gap-1">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  all,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  all: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Combobox
          id={id}
          aria-label={label}
          className={`${inputClass} w-auto!`}
          value={value}
          onChange={onChange}
          options={[{ value: "", label: all }, ...options]}
        />
      )}
    </Field>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  const money = useMoney();
  // All time by default, so print time matches the printer page.
  const [preset, setPreset] = useState<keyof typeof PRESETS>("all");
  const [f, setF] = useState<StatsFilters>({
    from: "",
    to: "",
    printerId: "",
    spoolId: "",
    materialId: "",
    projectId: "",
    tagId: "",
    outcome: "",
    bucket: "month",
  });
  // The long tables start at 10 rows; the pager shows more.
  const [projectQuery, setProjectQuery] = useState<ListQuery>({ pageSize: "10" });
  const [filamentQuery, setFilamentQuery] = useState<ListQuery>({ pageSize: "10" });
  const [metric, setMetric] = useState<keyof typeof METRICS>("prints");
  const set = (patch: Partial<StatsFilters>) => setF((cur) => ({ ...cur, ...patch }));
  const { data, isError } = useStats(f);

  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const spools = useSpools().data?.items ?? [];
  const profiles = useProfiles().data?.items ?? [];
  // Only the materials of your spools, not the whole catalog (presets bring dozens).
  const materials = [
    ...new Map(
      spools.flatMap((s) => {
        const p = profiles.find((x) => x.id === s.profileId);
        return p?.materialId ? [[p.materialId, p.material] as const] : [];
      }),
    ),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const projects = useProjects().data?.items ?? [];
  const tags = useTags().data ?? [];
  const all = t("stats:filters.all");

  const pickPreset = (p: keyof typeof PRESETS) => {
    setPreset(p);
    if (p === "custom") return;
    set({ from: p === "all" ? "" : dayStr(Number(p)), to: "" });
  };

  const tot = data?.totals;
  const rate = (m: StatsMetrics) =>
    m.prints ? `${Math.round((m.successes / m.prints) * 100)}%` : "–";
  const costColumns = <R extends Group>(name: string, label: (r: R) => string) => [
    {
      id: "name",
      header: name,
      cell: label,
      sortValue: (r: R) => label(r).toLowerCase(),
      filterValue: label,
    },
    {
      id: "prints",
      header: t("stats:metrics.prints"),
      numeric: true,
      cell: (r: R) => formatNumber(r.prints),
      sortValue: (r: R) => r.prints,
      filterValue: (r: R) => r.prints,
    },
    {
      id: "hours",
      header: t("stats:metrics.hours"),
      numeric: true,
      cell: (r: R) => formatDuration(r.seconds),
      sortValue: (r: R) => r.seconds,
      filterValue: (r: R) => r.seconds,
      filterScale: 3600,
      filterHint: t("stats:hoursUnit"),
    },
    {
      id: "filament",
      header: t("stats:metrics.filament"),
      numeric: true,
      cell: (r: R) => formatWeight(r.grams),
      sortValue: (r: R) => r.grams,
      filterValue: (r: R) => r.grams,
    },
    {
      id: "total",
      header: t("stats:metrics.cost"),
      numeric: true,
      cell: (r: R) => money(r.total),
      sortValue: (r: R) => r.total,
      filterValue: (r: R) => r.total,
    },
  ];
  const outcomeLabel = (k: string | null) => t(OUTCOMES[k as keyof typeof OUTCOMES]);

  return (
    <>
      <PageHeader
        title={t("nav:items.stats.label")}
        description={t("nav:items.stats.description")}
        actions={
          <a
            href={`/api/stats/csv?${statsQs(f)}`}
            download="stats.csv"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2"
          >
            <Download className="size-4" aria-hidden />
            {t("stats:export")}
          </a>
        }
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("stats:loadError")}
        </p>
      )}

      <search className="mb-5 flex flex-wrap items-end gap-2">
        <Field label={t("stats:filters.period")}>
          {(id) => (
            <Combobox
              id={id}
              aria-label={t("stats:filters.period")}
              className={`${inputClass} w-auto!`}
              value={preset}
              onChange={(v) => pickPreset(v as keyof typeof PRESETS)}
              options={(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((p) => ({
                value: p,
                label: t(PRESETS[p]),
              }))}
            />
          )}
        </Field>
        {preset === "custom" && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">{t("stats:presets.custom")}</span>
            <DateRangePicker
              value={{ from: f.from || undefined, to: f.to || undefined }}
              onChange={(r) => set({ from: r.from ?? "", to: r.to ?? "" })}
            />
          </div>
        )}
        <Select
          label={t("stats:filters.printer")}
          all={all}
          value={f.printerId}
          onChange={(printerId) => set({ printerId })}
          options={printers.map((p) => ({ value: p.id, label: printerName(t, p) }))}
        />
        <Select
          label={t("stats:filters.spool")}
          all={all}
          value={f.spoolId}
          onChange={(spoolId) => set({ spoolId })}
          options={spools.map((s) => ({
            value: s.id,
            label: spoolName(
              t,
              s,
              profiles.find((p) => p.id === s.profileId),
            ),
          }))}
        />
        <Select
          label={t("stats:filters.material")}
          all={all}
          value={f.materialId}
          onChange={(materialId) => set({ materialId })}
          options={materials}
        />
        <Select
          label={t("stats:filters.outcome")}
          all={all}
          value={f.outcome}
          onChange={(outcome) => set({ outcome })}
          options={(Object.keys(OUTCOMES) as (keyof typeof OUTCOMES)[]).map((o) => ({
            value: o,
            label: t(OUTCOMES[o]),
          }))}
        />
        <Select
          label={t("stats:filters.project")}
          all={all}
          value={f.projectId}
          onChange={(projectId) => set({ projectId })}
          options={[...projects]
            .sort((a, b) => b.number - a.number)
            .map((p) => ({ value: p.id, label: projectName(t, p) }))}
        />
        {tags.length > 0 && (
          <Select
            label={t("stats:filters.tag")}
            all={all}
            value={f.tagId}
            onChange={(tagId) => set({ tagId })}
            options={tags.map((x) => ({ value: x.id, label: x.name }))}
          />
        )}
      </search>

      {data && tot && !tot.prints ? (
        <EmptyState
          icon={ChartColumn}
          title={t("stats:emptyTitle")}
          description={t("stats:emptyBody")}
        />
      ) : (
        data &&
        tot && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label={t("stats:metrics.prints")} value={formatNumber(tot.prints)} />
              <StatCard label={t("stats:metrics.successRate")} value={rate(tot)} />
              <StatCard
                label={t("stats:metrics.hours")}
                value={formatDuration(tot.seconds)}
                hint={
                  tot.estimatedSeconds > 0
                    ? t("stats:estimated", { duration: formatDuration(tot.estimatedSeconds) })
                    : undefined
                }
              />
              <StatCard
                label={t("stats:metrics.filament")}
                value={formatWeight(tot.grams)}
                hint={
                  tot.unpricedGrams > 0
                    ? t("stats:unpriced", { weight: formatWeight(tot.unpricedGrams) })
                    : money(tot.material)
                }
              />
              <StatCard
                label={t("stats:metrics.energy")}
                value={formatEnergy(tot.energyWh / 1000)}
                hint={money(tot.energy)}
              />
              <StatCard label={t("stats:metrics.wear")} value={money(tot.wear + tot.maintenance)} />
              <StatCard label={t("stats:metrics.cost")} value={money(tot.total)} />
              <StatCard
                label={t("stats:metrics.costPerPrint")}
                value={money(tot.prints ? Math.round(tot.total / tot.prints) : 0)}
              />
            </div>

            <section aria-labelledby="stats-series">
              <div className="mb-2 flex flex-wrap items-end gap-2">
                <h2 id="stats-series" className="mr-auto text-base font-semibold">
                  {t("stats:series.title")}
                </h2>
                <Field label={t("stats:series.metric")}>
                  {(id) => (
                    <Combobox
                      id={id}
                      aria-label={t("stats:series.metric")}
                      className={`${inputClass} w-auto!`}
                      value={metric}
                      onChange={(v) => setMetric(v as keyof typeof METRICS)}
                      options={(Object.keys(METRICS) as (keyof typeof METRICS)[]).map((m) => ({
                        value: m,
                        label: t(METRICS[m]),
                      }))}
                    />
                  )}
                </Field>
                <Field label={t("stats:series.bucket")}>
                  {(id) => (
                    <Combobox
                      id={id}
                      aria-label={t("stats:series.bucket")}
                      className={`${inputClass} w-auto!`}
                      value={f.bucket}
                      onChange={(v) => set({ bucket: v as StatsFilters["bucket"] })}
                      options={(Object.keys(BUCKETS) as (keyof typeof BUCKETS)[]).map((b) => ({
                        value: b,
                        label: t(BUCKETS[b]),
                      }))}
                    />
                  )}
                </Field>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <BarSeries series={data.series} metric={metric} height={240} />
              </div>
            </section>

            <div className="grid gap-6 2xl:grid-cols-2">
              <DataTable
                label={t("stats:by.printer")}
                rows={data.breakdowns.printer}
                rowKey={(r) => r.key ?? ""}
                columns={costColumns<Group>(t("stats:by.printer"), (r) => r.label ?? "")}
              />
              <DataTable
                label={t("stats:by.outcome")}
                rows={data.breakdowns.outcome}
                rowKey={(r) => r.key ?? ""}
                columns={costColumns<Group>(t("stats:by.outcome"), (r) => outcomeLabel(r.key))}
              />
            </div>
            <DataTable
              label={t("stats:by.project")}
              rows={data.breakdowns.project}
              rowKey={(r) => r.key ?? ""}
              client={{ query: projectQuery, onQueryChange: setProjectQuery }}
              columns={costColumns<Group>(
                t("stats:by.project"),
                (r) => r.label ?? t("stats:noProject"),
              )}
            />
            <DataTable
              label={t("stats:by.filament")}
              rows={data.breakdowns.filament}
              rowKey={(r) => r.key ?? ""}
              client={{ query: filamentQuery, onQueryChange: setFilamentQuery }}
              columns={costColumns<Group>(
                t("stats:by.filament"),
                (r) => r.label ?? t("stats:noFilament"),
              )}
            />
          </div>
        )
      )}
    </>
  );
}
