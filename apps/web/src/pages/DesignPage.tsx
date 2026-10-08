import { Printer } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { DataTable } from "../components/DataTable.tsx";
import { type DateRange, DateRangePicker } from "../components/DateRangePicker.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { FormField, inputClass } from "../components/FormField.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { StatCard } from "../components/StatCard.tsx";
import {
  formatCurrency,
  formatDate,
  formatDuration,
  formatEnergy,
  formatWeight,
} from "../lib/format.ts";
import { ACCENTS, useTheme } from "../lib/theme.ts";

type Row = {
  id: string;
  name: string;
  state: "working" | "maintenance" | "inoperative";
  seconds: number;
  last: string;
  grams: number;
};

const ROWS: Row[] = [
  {
    id: "1",
    name: "Bambu X1C",
    state: "working",
    seconds: 412_800,
    last: "2026-10-06",
    grams: 18_420,
  },
  {
    id: "2",
    name: "Prusa MK4S",
    state: "maintenance",
    seconds: 190_200,
    last: "2026-09-28",
    grams: 7_900,
  },
  {
    id: "3",
    name: "Ender 3 V2",
    state: "inoperative",
    seconds: 85_500,
    last: "2026-07-14",
    grams: 3_150,
  },
];

const STATE = {
  working: { dot: "bg-ok", label: "design:states.working" },
  maintenance: { dot: "bg-warn", label: "design:states.maintenance" },
  inoperative: { dot: "bg-bad", label: "design:states.inoperative" },
};

const ACCENT_LABEL = {
  teal: "design:accents.teal",
  blue: "design:accents.blue",
  violet: "design:accents.violet",
  rose: "design:accents.rose",
  amber: "design:accents.amber",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function DesignPage() {
  const { t } = useTranslation();
  const { accent, setAccent } = useTheme();
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<DateRange>({});
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState("");
  const rows = ROWS.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader
        title={t("design:title")}
        description={t("design:description")}
        actions={
          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">{t("design:accent")}</legend>
            {ACCENTS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={accent === a}
                aria-label={t(ACCENT_LABEL[a])}
                title={t(ACCENT_LABEL[a])}
                onClick={() => setAccent(a)}
                data-accent={a}
                style={{ background: "oklch(0.6 0.12 var(--hue))" }}
                className="size-6 rounded-full ring-offset-2 ring-offset-bg aria-pressed:ring-2 aria-pressed:ring-fg"
              />
            ))}
          </fieldset>
        }
      />

      <Section title={t("design:sections.stats")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("design:stats.hours")} value={formatDuration(688_500)} />
          <StatCard label={t("design:stats.filament")} value={formatWeight(29_470)} />
          <StatCard label={t("design:stats.energy")} value={formatEnergy(86.4)} />
          <StatCard label={t("design:stats.cost")} value={formatCurrency(142.8)} />
        </div>
      </Section>

      <Section title={t("design:sections.table")}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchLabel={t("design:filters.search")}
            onReset={
              search || range.from || range.to
                ? () => {
                    setSearch("");
                    setRange({});
                  }
                : undefined
            }
          >
            <DateRangePicker value={range} onChange={setRange} />
          </FilterBar>
        </div>
        <DataTable
          label={t("design:table.label")}
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            {
              id: "name",
              header: t("design:table.printer"),
              cell: (r) => r.name,
              sortValue: (r) => r.name,
            },
            {
              id: "state",
              header: t("design:table.state"),
              cell: (r) => (
                <span className="inline-flex items-center gap-2">
                  <span className={`size-2 rounded-full ${STATE[r.state].dot}`} aria-hidden />
                  {t(STATE[r.state].label)}
                </span>
              ),
            },
            {
              id: "hours",
              header: t("design:table.hours"),
              numeric: true,
              cell: (r) => formatDuration(r.seconds),
              sortValue: (r) => r.seconds,
            },
            {
              id: "filament",
              header: t("design:table.filament"),
              numeric: true,
              cell: (r) => formatWeight(r.grams),
              sortValue: (r) => r.grams,
            },
            {
              id: "last",
              header: t("design:table.lastPrint"),
              numeric: true,
              cell: (r) => formatDate(r.last),
              sortValue: (r) => r.last,
            },
          ]}
        />
      </Section>

      <div className="grid gap-8 md:grid-cols-2">
        <Section title={t("design:sections.form")}>
          <div className="flex flex-col gap-4">
            <FormField label={t("design:form.name")} hint={t("design:form.nameHint")}>
              {(p) => <input {...p} className={inputClass} />}
            </FormField>
            <FormField label={t("design:form.name")} error={t("design:form.nameError")}>
              {(p) => (
                <input
                  {...p}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              )}
            </FormField>
          </div>
        </Section>

        <Section title={t("design:sections.dialog")}>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {t("design:confirm.open")}
          </Button>
          <ConfirmDialog
            open={confirm}
            destructive
            title={t("design:confirm.title")}
            description={t("design:confirm.body")}
            confirmLabel={t("design:confirm.action")}
            onConfirm={() => setConfirm(false)}
            onCancel={() => setConfirm(false)}
          />
        </Section>
      </div>

      <Section title={t("design:sections.empty")}>
        <EmptyState
          icon={Printer}
          title={t("design:empty.title")}
          description={t("design:empty.body")}
          action={<Button variant="primary">{t("design:empty.action")}</Button>}
        />
      </Section>
    </>
  );
}
