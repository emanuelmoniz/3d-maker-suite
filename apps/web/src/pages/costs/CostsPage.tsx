import {
  type CostContext,
  computeCost,
  computeQuote,
  estimateEnergyWh,
  type Quote,
  toMinor,
} from "@3d-maker-suite/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { CostBreakdown, QuoteBreakdownView } from "../../components/CostBreakdown.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { SettingsLink } from "../../components/SettingsLink.tsx";
import { useClients } from "../../lib/clients.ts";
import {
  materialPrice,
  quoteName,
  useCostContext,
  usePatchQuote,
  useQuote,
  useSaveQuote,
} from "../../lib/cost.ts";
import { printerName } from "../../lib/printers.ts";
import { projectName, useProjects } from "../../lib/projects.ts";
import { NewClientDialog } from "../clients/NewClientDialog.tsx";
import { QuotesTable } from "./QuotesTable.tsx";

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

/** `editing`: the saved quote opened from a table (`/costs?quote=<id>`), restored as saved. */
function Calculator({ ctx, editing }: { ctx: CostContext; editing?: Quote }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useProjects().data?.items ?? [];
  // ponytail: first 100 clients in the picker (it searches them); a server search if anyone has more.
  const clients = useClients({ pageSize: "100" }).data?.items ?? [];
  const save = useSaveQuote();
  const patch = usePatchQuote();
  const [f, setF] = useState<Form>(() => ({
    ...initial(ctx),
    ...(editing?.form as Partial<Form> | undefined),
  }));
  const [name, setName] = useState(editing?.name ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [clientId, setClientId] = useState(editing?.clientId ?? "");
  const [newClient, setNewClient] = useState(false);
  const open = (id?: string) =>
    navigate({ to: "/costs", search: ((s: object) => ({ ...s, quote: id })) as never });
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
          grams: Math.round((x.grams as number) * 100) / 100,
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
  const body = {
    name,
    notes,
    clientId: clientId || null,
    projectId: f.projectId || null,
    form: f,
    cost,
    quote,
  };
  const saveNew = () => save.mutate(body, { onSuccess: (q) => open(q.id) });

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
              <Combobox
                value={f.projectId}
                onChange={(v) => set({ projectId: v, plate: "" })}
                options={[
                  { value: "", label: t("costs:form.noProject") },
                  ...projects.map((p) => ({ value: p.id, label: projectName(t, p) })),
                ]}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="font-medium">{t("costs:form.plate")}</span>
              <Combobox
                value={f.plate}
                disabled={!plates.length}
                onChange={pickPlate}
                options={[
                  { value: "", label: t("costs:form.noPlate") },
                  ...plates.map(({ file, pl }) => ({
                    value: `${file}#${pl.index}`,
                    label: `${file} · ${pl.name ?? t("costs:form.plateN", { index: pl.index })}`,
                  })),
                ]}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="font-medium">{t("costs:form.printer")}</span>
              <Combobox
                value={f.printerId}
                onChange={(v) => {
                  const p = ctx.printers.find((x) => x.id === v);
                  set({ printerId: v, powerW: p?.powerW ?? f.powerW });
                }}
                options={[
                  { value: "", label: t("costs:form.noPrinter") },
                  ...ctx.printers.map((p) => ({ value: p.id, label: printerName(t, p) })),
                ]}
              />
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
                  step={0.01}
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
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (editing) patch.mutate({ id: editing.id, ...body });
              else saveNew();
            }}
          >
            {editing && (
              <p className="flex flex-wrap items-center justify-between gap-2 text-muted">
                {t("costs:saved.editing", { name: quoteName(t, editing) })}
                <Button variant="ghost" onClick={() => open(undefined)}>
                  {t("costs:saved.new")}
                </Button>
              </p>
            )}
            <FormField label={t("costs:saved.name")}>
              {(p) => (
                <input
                  {...p}
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField label={t("costs:saved.client")}>
              {(p) => (
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Combobox
                      {...p}
                      value={clientId}
                      onChange={setClientId}
                      options={[
                        { value: "", label: t("costs:saved.noClient") },
                        ...clients.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                    />
                  </div>
                  <Button onClick={() => setNewClient(true)}>
                    <Plus className="size-4" aria-hidden />
                    {t("costs:saved.newClient")}
                  </Button>
                </div>
              )}
            </FormField>
            <FormField label={t("costs:saved.notes")}>
              {(p) => (
                <textarea
                  {...p}
                  className={`${inputClass} h-20 py-2`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              )}
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={save.isPending || patch.isPending}>
                {t(editing ? "costs:saved.update" : "costs:saved.save")}
              </Button>
              {editing && (
                <Button disabled={save.isPending || !name.trim()} onClick={saveNew}>
                  {t("costs:saved.saveAsNew")}
                </Button>
              )}
            </div>
            {patch.isSuccess && (
              <p role="status" className="text-muted">
                {t("costs:saved.updated")}
              </p>
            )}
          </form>
          {(save.isError || patch.isError) && (
            <p role="alert" className="mt-2 text-bad">
              {t("costs:saved.saveError")}
            </p>
          )}
          <NewClientDialog
            open={newClient}
            onClose={() => setNewClient(false)}
            onSaved={(c) => setClientId(c.id)}
          />
        </section>
      </div>
    </div>
  );
}

export function CostsPage() {
  const { t } = useTranslation();
  const { data, isError } = useCostContext();
  const { quote: quoteId } = useSearch({ strict: false }) as { quote?: string };
  const opened = useQuote(quoteId);
  return (
    <>
      <PageHeader
        title={t("nav:items.costs.label")}
        description={t("nav:items.costs.description")}
        actions={<SettingsLink module="costs" />}
      />
      {isError && (
        <p role="alert" className="text-bad">
          {t("costs:loadError")}
        </p>
      )}
      {opened.isError && (
        <p role="alert" className="mb-4 text-bad">
          {t("costs:saved.notFound")}
        </p>
      )}
      {/* Remounts with the opened quote's values (or blank for a new one). */}
      {data && (!quoteId || opened.data || opened.isError) && (
        <Calculator key={opened.data?.id ?? "new"} ctx={data} editing={opened.data} />
      )}
      <section aria-labelledby="c-saved" className="mt-6">
        <h2 id="c-saved" className="mb-2 text-base font-semibold">
          {t("costs:saved.title")}
        </h2>
        <QuotesTable />
      </section>
    </>
  );
}
