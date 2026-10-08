import {
  type CostContext,
  computeCost,
  computeQuote,
  estimateEnergyWh,
  toMinor,
} from "@3d-maker-suite/core";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { CostBreakdown, QuoteBreakdownView } from "../../components/CostBreakdown.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import {
  materialPrice,
  useCostContext,
  useDeleteQuote,
  useMoney,
  useQuotes,
  useSaveQuote,
} from "../../lib/cost.ts";
import { formatDate } from "../../lib/format.ts";
import { useProjects } from "../../lib/projects.ts";

type Row = { label: string; grams: number; price: number | null };
/** Calculator state. Money is in major units here (what people type), minor units in the maths. */
type Form = {
  printerId: string;
  projectId: string;
  plate: string; // "<3mf file>#<plate index>" or ""
  powerW: number;
  minutes: number;
  filaments: Row[];
  laborHours: number;
  laborRate: number;
  failureMarginPct: number;
  markupPct: number;
  quantity: number;
};

const emptyRow = (): Row => ({ label: "", grams: 0, price: null });

const initial = (ctx: CostContext): Form => ({
  printerId: "",
  projectId: "",
  plate: "",
  powerW: 0,
  minutes: 0,
  filaments: [emptyRow()],
  laborHours: 0,
  laborRate: ctx.quoteDefaults.laborRatePerHour / 100,
  failureMarginPct: ctx.quoteDefaults.failureMarginPct,
  markupPct: ctx.quoteDefaults.markupPct,
  quantity: 1,
});

function Num({
  label,
  value,
  onChange,
  step = 1,
  nullable,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  step?: number;
  nullable?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="font-medium">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        className={inputClass}
        value={value ?? ""}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          onChange(Number.isFinite(n) ? n : nullable ? null : 0);
        }}
      />
    </label>
  );
}

const panel = "grid gap-4 rounded-lg border border-border bg-surface p-4";

function Calculator({ ctx }: { ctx: CostContext }) {
  const { t } = useTranslation();
  const money = useMoney();
  const projects = useProjects().data?.items ?? [];
  const quotes = useQuotes().data ?? [];
  const save = useSaveQuote();
  const del = useDeleteQuote();
  const [f, setF] = useState(() => initial(ctx));
  const [name, setName] = useState("");
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));
  const printer = ctx.printers.find((p) => p.id === f.printerId);

  const plates = projects
    .filter((p) => p.id === f.projectId)
    .flatMap((p) => p.meta.models.flatMap((m) => m.plates.map((pl) => ({ file: m.file, pl }))))
    .filter((x) => x.pl.sliced);

  const pickPlate = (key: string) => {
    const hit = plates.find((x) => `${x.file}#${x.pl.index}` === key);
    if (!hit) return set({ plate: "" });
    set({
      plate: key,
      minutes: Math.round((hit.pl.printTimeSeconds ?? 0) / 60),
      filaments: hit.pl.filaments
        .filter((x) => x.grams != null)
        .map((x) => ({
          label: x.type ?? "",
          grams: Math.round((x.grams as number) * 10) / 10,
          price: (materialPrice(ctx, x.type) ?? 0) / 100 || null,
        })),
    });
  };

  const durationSec = f.minutes * 60;
  const cost = computeCost(
    {
      durationSec,
      energyWh: estimateEnergyWh(f.powerW, durationSec),
      filaments: f.filaments.map((r) => ({
        grams: r.grams,
        pricePerKg: r.price == null ? null : toMinor(r.price),
      })),
    },
    {
      energyPerKwh: ctx.rates.energyPerKwh,
      wearPerHour: printer?.wearPerHour ?? 0,
      maintenancePerHour: printer?.maintenancePerHour ?? 0,
    },
  );
  const quote = computeQuote(cost.total, {
    laborHours: f.laborHours,
    laborRatePerHour: toMinor(f.laborRate),
    failureMarginPct: f.failureMarginPct,
    markupPct: f.markupPct,
    quantity: Math.max(1, Math.round(f.quantity)),
  });
  const row = (i: number, patch: Partial<Row>) =>
    set({ filaments: f.filaments.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="grid content-start gap-6">
        <section aria-labelledby="c-print" className={panel}>
          <h2 id="c-print" className="text-base font-semibold">
            {t("costs:form.print")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="font-medium">{t("costs:form.project")}</span>
              <select
                className={inputClass}
                value={f.projectId}
                onChange={(e) => set({ projectId: e.target.value, plate: "" })}
              >
                <option value="">{t("costs:form.noProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="font-medium">{t("costs:form.plate")}</span>
              <select
                className={inputClass}
                value={f.plate}
                disabled={!plates.length}
                onChange={(e) => pickPlate(e.target.value)}
              >
                <option value="">{t("costs:form.noPlate")}</option>
                {plates.map(({ file, pl }) => (
                  <option key={`${file}#${pl.index}`} value={`${file}#${pl.index}`}>
                    {file} · {pl.name ?? t("costs:form.plateN", { index: pl.index })}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="font-medium">{t("costs:form.printer")}</span>
              <select
                className={inputClass}
                value={f.printerId}
                onChange={(e) => {
                  const p = ctx.printers.find((x) => x.id === e.target.value);
                  set({ printerId: e.target.value, powerW: p?.powerW ?? f.powerW });
                }}
              >
                <option value="">{t("costs:form.noPrinter")}</option>
                {ctx.printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Num
              label={t("costs:form.power")}
              value={f.powerW}
              onChange={(n) => set({ powerW: n ?? 0 })}
            />
            <Num
              label={t("costs:form.minutes")}
              value={f.minutes}
              onChange={(n) => set({ minutes: n ?? 0 })}
            />
          </div>

          <h3 className="font-medium">{t("costs:form.filament")}</h3>
          <ul className="grid gap-3">
            {f.filaments.map((r, i) => (
              <li
                key={i}
                className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_7rem_8rem_auto]"
              >
                <label className="col-span-2 grid gap-1.5 sm:col-span-1">
                  <span className="font-medium">{t("costs:form.material")}</span>
                  <input
                    className={inputClass}
                    value={r.label}
                    onChange={(e) => row(i, { label: e.target.value })}
                  />
                </label>
                <Num
                  label={t("costs:form.grams")}
                  value={r.grams}
                  step={0.1}
                  onChange={(n) => row(i, { grams: n ?? 0 })}
                />
                <Num
                  label={t("costs:form.pricePerKg")}
                  value={r.price}
                  step={0.01}
                  nullable
                  onChange={(n) => row(i, { price: n })}
                />
                <Button
                  variant="ghost"
                  aria-label={t("costs:form.removeFilament")}
                  disabled={f.filaments.length === 1}
                  onClick={() => set({ filaments: f.filaments.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button onClick={() => set({ filaments: [...f.filaments, emptyRow()] })}>
              <Plus className="size-4" aria-hidden />
              {t("costs:form.addFilament")}
            </Button>
          </div>
        </section>

        <section aria-labelledby="c-price" className={panel}>
          <h2 id="c-price" className="text-base font-semibold">
            {t("costs:form.pricing")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Num
              label={t("costs:form.laborHours")}
              value={f.laborHours}
              step={0.25}
              onChange={(n) => set({ laborHours: n ?? 0 })}
            />
            <Num
              label={t("costs:form.laborRate")}
              value={f.laborRate}
              step={0.5}
              onChange={(n) => set({ laborRate: n ?? 0 })}
            />
            <Num
              label={t("costs:form.failureMargin")}
              value={f.failureMarginPct}
              step={0.5}
              onChange={(n) => set({ failureMarginPct: n ?? 0 })}
            />
            <Num
              label={t("costs:form.markup")}
              value={f.markupPct}
              onChange={(n) => set({ markupPct: n ?? 0 })}
            />
            <Num
              label={t("costs:form.quantity")}
              value={f.quantity}
              onChange={(n) => set({ quantity: n ?? 1 })}
            />
          </div>
        </section>
      </div>

      <div className="grid content-start gap-6">
        <section
          aria-labelledby="c-cost"
          className="rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="c-cost" className="mb-2 text-base font-semibold">
            {t("costs:cost.title")}
          </h2>
          <CostBreakdown cost={cost} />
        </section>
        <section
          aria-labelledby="c-quote"
          className="rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="c-quote" className="mb-2 text-base font-semibold">
            {t("costs:quote.title")}
          </h2>
          <QuoteBreakdownView quote={quote} />
          <form
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(
                { name, projectId: f.projectId || null, form: f, cost, quote },
                { onSuccess: () => setName("") },
              );
            }}
          >
            <input
              className={`${inputClass} min-w-0 flex-1`}
              aria-label={t("costs:saved.name")}
              placeholder={t("costs:saved.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {t("costs:saved.save")}
            </Button>
          </form>
          {save.isError && (
            <p role="alert" className="mt-2 text-bad">
              {t("costs:saved.saveError")}
            </p>
          )}
        </section>

        <section aria-labelledby="c-saved">
          <h2 id="c-saved" className="mb-2 text-base font-semibold">
            {t("costs:saved.title")}
          </h2>
          {quotes.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {quotes.map((q) => (
                <li key={q.id} className="grid gap-1 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{q.name}</span>
                    <span className="tabular-nums">{money(q.quote.total)}</span>
                  </div>
                  <p className="text-muted">
                    {[
                      projectName(q.projectId),
                      t("costs:saved.pieces", { count: q.quote.quantity }),
                      formatDate(q.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => setF({ ...initial(ctx), ...(q.form as Partial<Form>) })}>
                      {t("costs:saved.load")}
                    </Button>
                    <Button variant="ghost" onClick={() => del.mutate(q.id)}>
                      {t("costs:saved.delete")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">{t("costs:saved.empty")}</p>
          )}
        </section>
      </div>
    </div>
  );
}

export function CostsPage() {
  const { t } = useTranslation();
  const { data, isError } = useCostContext();
  return (
    <>
      <PageHeader
        title={t("nav:items.costs.label")}
        description={t("nav:items.costs.description")}
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("costs:loadError")}
        </p>
      )}
      {data && <Calculator ctx={data} />}
    </>
  );
}
