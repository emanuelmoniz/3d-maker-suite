import type { Stats, StatsMetrics } from "@3d-maker-suite/core";
import { ChartColumn, Download } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable.tsx";
import { DateRangePicker } from "../../components/DateRangePicker.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import { useMoney } from "../../lib/cost.ts";
import { filamentLabel, useProfiles, useSpools } from "../../lib/filament.ts";
import {
  formatDate,
  formatDuration,
  formatEnergy,
  formatNumber,
  formatWeight,
} from "../../lib/format.ts";
import { usePrinters } from "../../lib/printers.ts";
import { useProjects } from "../../lib/projects.ts";
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
type FilamentGroup = Stats["breakdowns"]["filament"][number];

const dayStr = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

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
    <select
      aria-label={label}
      className={`${inputClass} w-auto!`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function StatsPage() {
  const { t } = useTranslation();
  const money = useMoney();
  const [preset, setPreset] = useState<keyof typeof PRESETS>("90");
  const [f, setF] = useState<StatsFilters>({
    from: dayStr(90),
    to: "",
    printerId: "",
    spoolId: "",
    profileId: "",
    projectId: "",
    tagId: "",
    outcome: "",
    bucket: "week",
  });
  const [metric, setMetric] = useState<keyof typeof METRICS>("prints");
  const set = (patch: Partial<StatsFilters>) => setF((cur) => ({ ...cur, ...patch }));
  const { data, isError } = useStats(f);

  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const spools = useSpools().data?.items ?? [];
  const profiles = useProfiles().data?.items ?? [];
  const projects = useProjects().data?.items ?? [];
  const tags = useTags().data ?? [];
  const all = t("stats:filters.all");

  const pickPreset = (p: keyof typeof PRESETS) => {
    setPreset(p);
    if (p === "custom") return;
    set({ from: p === "all" ? "" : dayStr(Number(p)), to: "" });
  };

  const value = (m: StatsMetrics) =>
    metric === "prints" ? m.prints : metric === "hours" ? m.seconds / 3600 : m.total / 100;
  const shown = (m: StatsMetrics) =>
    metric === "prints"
      ? formatNumber(m.prints)
      : metric === "hours"
        ? formatDuration(m.seconds)
        : money(m.total);

  const tot = data?.totals;
  const max = Math.max(1, ...(data?.series.map(value) ?? []));
  const rate = (m: StatsMetrics) =>
    m.prints ? `${Math.round((m.successes / m.prints) * 100)}%` : "–";
  const costColumns = <R extends Group>(name: string, label: (r: R) => ReactNode) => [
    { id: "name", header: name, cell: label },
    {
      id: "prints",
      header: t("stats:metrics.prints"),
      numeric: true,
      cell: (r: R) => formatNumber(r.prints),
      sortValue: (r: R) => r.prints,
    },
    {
      id: "hours",
      header: t("stats:metrics.hours"),
      numeric: true,
      cell: (r: R) => formatDuration(r.seconds),
      sortValue: (r: R) => r.seconds,
    },
    {
      id: "filament",
      header: t("stats:metrics.filament"),
      numeric: true,
      cell: (r: R) => formatWeight(r.grams),
      sortValue: (r: R) => r.grams,
    },
    {
      id: "total",
      header: t("stats:metrics.cost"),
      numeric: true,
      cell: (r: R) => money(r.total),
      sortValue: (r: R) => r.total,
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

      <search className="mb-5 flex flex-wrap items-center gap-2">
        <select
          aria-label={t("stats:filters.period")}
          className={`${inputClass} w-auto!`}
          value={preset}
          onChange={(e) => pickPreset(e.target.value as keyof typeof PRESETS)}
        >
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((p) => (
            <option key={p} value={p}>
              {t(PRESETS[p])}
            </option>
          ))}
        </select>
        {preset === "custom" && (
          <DateRangePicker
            value={{ from: f.from || undefined, to: f.to || undefined }}
            onChange={(r) => set({ from: r.from ?? "", to: r.to ?? "" })}
          />
        )}
        <Select
          label={t("stats:filters.printer")}
          all={all}
          value={f.printerId}
          onChange={(printerId) => set({ printerId })}
          options={printers.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Select
          label={t("stats:filters.spool")}
          all={all}
          value={f.spoolId}
          onChange={(spoolId) => set({ spoolId })}
          options={spools.map((s) => ({
            value: s.id,
            label: filamentLabel(profiles.find((p) => p.id === s.profileId)),
          }))}
        />
        <Select
          label={t("stats:filters.profile")}
          all={all}
          value={f.profileId}
          onChange={(profileId) => set({ profileId })}
          options={profiles.map((p) => ({ value: p.id, label: filamentLabel(p) }))}
        />
        <Select
          label={t("stats:filters.project")}
          all={all}
          value={f.projectId}
          onChange={(projectId) => set({ projectId })}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Select
          label={t("stats:filters.tag")}
          all={all}
          value={f.tagId}
          onChange={(tagId) => set({ tagId })}
          options={tags.map((x) => ({ value: x.id, label: x.name }))}
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
              <StatCard label={t("stats:metrics.hours")} value={formatDuration(tot.seconds)} />
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
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 id="stats-series" className="mr-auto text-base font-semibold">
                  {t("stats:series.title")}
                </h2>
                <select
                  aria-label={t("stats:series.metric")}
                  className={`${inputClass} w-auto!`}
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as keyof typeof METRICS)}
                >
                  {(Object.keys(METRICS) as (keyof typeof METRICS)[]).map((m) => (
                    <option key={m} value={m}>
                      {t(METRICS[m])}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("stats:series.bucket")}
                  className={`${inputClass} w-auto!`}
                  value={f.bucket}
                  onChange={(e) => set({ bucket: e.target.value as StatsFilters["bucket"] })}
                >
                  {(Object.keys(BUCKETS) as (keyof typeof BUCKETS)[]).map((b) => (
                    <option key={b} value={b}>
                      {t(BUCKETS[b])}
                    </option>
                  ))}
                </select>
              </div>
              <ul className="flex h-40 items-end gap-px overflow-x-auto rounded-lg border border-border bg-surface p-3">
                {data.series.map((r) => (
                  <li
                    key={r.key}
                    title={`${formatDate(r.key)}: ${shown(r)}`}
                    aria-label={`${formatDate(r.key)}: ${shown(r)}`}
                    className="min-w-1 flex-1 rounded-t bg-accent"
                    style={{ height: `${Math.max(2, (value(r) / max) * 100)}%` }}
                  />
                ))}
              </ul>
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <DataTable
                label={t("stats:by.printer")}
                rows={data.breakdowns.printer}
                rowKey={(r) => r.key ?? ""}
                columns={costColumns<Group>(t("stats:by.printer"), (r) => r.label)}
              />
              <DataTable
                label={t("stats:by.project")}
                rows={data.breakdowns.project}
                rowKey={(r) => r.key ?? ""}
                columns={costColumns<Group>(
                  t("stats:by.project"),
                  (r) => r.label ?? t("stats:noProject"),
                )}
              />
              <DataTable
                label={t("stats:by.outcome")}
                rows={data.breakdowns.outcome}
                rowKey={(r) => r.key ?? ""}
                columns={costColumns<Group>(t("stats:by.outcome"), (r) => outcomeLabel(r.key))}
              />
              <DataTable
                label={t("stats:by.filament")}
                rows={data.breakdowns.filament}
                rowKey={(r) => r.key ?? ""}
                columns={costColumns<FilamentGroup>(t("stats:by.filament"), (r) => (
                  <span className="flex items-center gap-2">
                    {r.colorHex && (
                      <span
                        aria-hidden
                        className="size-3 rounded-full border border-border"
                        style={{ background: r.colorHex }}
                      />
                    )}
                    {r.label ?? t("stats:noFilament")}
                  </span>
                ))}
              />
            </div>
          </div>
        )
      )}
    </>
  );
}
