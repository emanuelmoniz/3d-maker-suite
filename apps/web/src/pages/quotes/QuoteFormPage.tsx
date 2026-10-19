import {
  type CostContext,
  computeCost,
  computeQuote,
  estimateEnergyWh,
  type PlateSetupInput,
  type ProjectSlicing,
  QUOTE_UPLOAD_PREFIX,
  type Quote,
  type QuoteUpload,
  toMinor,
} from "@3d-maker-suite/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link, type LinkProps, useNavigate, useParams } from "@tanstack/react-router";
import { ClipboardList, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { CostBreakdown, QuoteBreakdownView } from "../../components/CostBreakdown.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PlateSlice, plateKey, SliceSetup } from "../../components/SliceSetup.tsx";
import { api } from "../../lib/api.ts";
import { useClients } from "../../lib/clients.ts";
import {
  changePlates,
  estimateSlicedPlates,
  type QuotePlate,
  quoteFileUrl,
  quoteName,
  useCostContext,
  usePatchQuote,
  useQuote,
  useQuoteSlice,
  useRunQuoteSlice,
  useSaveQuote,
  useUploadQuoteFile,
} from "../../lib/cost.ts";
import { useProfiles, useSpools } from "../../lib/filament.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { printerName } from "../../lib/printers.ts";
import { projectFileUrl, projectName, useProjectSlicing, useProjects } from "../../lib/projects.ts";
import { NewClientDialog } from "../clients/NewClientDialog.tsx";

type Row = { label: string; grams: number; price: number | null };
/**
 * Calculator state, saved as the quote's `form`. Money is in major units here (what people type),
 * minor units in the maths. One print = every plate once, plus the part typed in by hand.
 */
type Form = {
  projectId: string;
  /** 3MFs added to this quote; their plates' `file` is `upload:<id>`. */
  uploads: QuoteUpload[];
  /** Plates of the project's or the uploaded 3MFs, with their slice once sliced. */
  plates: QuotePlate[];
  // Typed in by hand and added to the plates (all a quote had before Step 18).
  printerId: string;
  powerW: number;
  minutes: number;
  filaments: Row[];
  /** Prints. */
  quantity: number;
  /** Per print. */
  laborHours: number;
  laborRate: number;
  failureMarginPct: number;
  markupPct: number;
};

const emptyRow = (): Row => ({ label: "", grams: 0, price: null });

const initial = (ctx: CostContext): Form => ({
  projectId: "",
  uploads: [],
  plates: [],
  printerId: "",
  powerW: 0,
  minutes: 0,
  filaments: [emptyRow()],
  quantity: 1,
  laborHours: 0,
  laborRate: ctx.quoteDefaults.laborRatePerHour / 100,
  failureMarginPct: ctx.quoteDefaults.failureMarginPct,
  markupPct: ctx.quoteDefaults.markupPct,
});

/** A saved form over the defaults; quotes from before Step 18 lack the plates and had `plate`. */
function restore(ctx: CostContext, saved: Quote["form"] | undefined): Form {
  const { plate: _old, ...rest } = (saved ?? {}) as Partial<Form> & { plate?: unknown };
  return { ...initial(ctx), ...rest };
}

/** A project's saved setup as quote plates; a slice counts only while it's current. */
const fromProject = (s: ProjectSlicing): QuotePlate[] =>
  s.plates.map((p) => ({
    file: p.file,
    plate: p.plate,
    printerId: p.printerId,
    printProfileId: p.printProfileId,
    useDefaultPrintProfile: p.useDefaultPrintProfile,
    filaments: p.filaments,
    spools: p.spools,
    result: p.needsSlicing ? null : p.result,
  }));

const isUpload = (file: string) => file.startsWith(QUOTE_UPLOAD_PREFIX);

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

/** One print typed in by hand: only while the quote has no files. */
function ByHand({
  ctx,
  f,
  set,
}: {
  ctx: CostContext;
  f: Form;
  set: (patch: Partial<Form>) => void;
}) {
  const { t } = useTranslation();
  const row = (i: number, patch: Partial<Row>) =>
    set({ filaments: f.filaments.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <>
      <h3 className="font-medium">{t("costs:form.byHand")}</h3>
      <p className="-mt-2 text-muted">{t("costs:form.byHandHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
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

      <h4 className="font-medium">{t("costs:form.filament")}</h4>
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
    </>
  );
}

/** A new quote, or `editing` (its page, `/quotes/<id>`) restored as saved. */
function QuoteForm({ ctx, editing }: { ctx: CostContext; editing?: Quote }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useProjects().data?.items ?? [];
  // ponytail: first 100 clients in the picker (it searches them); a server search if anyone has more.
  const clients = useClients({ pageSize: "100" }).data?.items ?? [];
  const save = useSaveQuote();
  const patch = usePatchQuote();
  const qc = useQueryClient();
  const upload = useUploadQuoteFile();
  const runSlice = useRunQuoteSlice();
  const profiles = useProfiles().data?.items ?? [];
  const spools = useSpools().data?.items ?? [];
  const defaultPrinterId = usePreferences().data?.values.defaultPrinterId;
  const [f, setF] = useState<Form>(() => restore(ctx, editing?.form));
  const [name, setName] = useState(editing?.name ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [clientId, setClientId] = useState(editing?.clientId ?? "");
  const [newClient, setNewClient] = useState(false);
  // Plates unticked here, so ticking one again brings its setup (and slice) back.
  const [unticked, setUnticked] = useState<QuotePlate[]>([]);
  // Replaces the page, so Back still leads to the list after a save.
  const open = (id: string) => navigate({ to: "/quotes/$id", params: { id }, replace: true });
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));
  const printer = ctx.printers.find((p) => p.id === f.printerId);
  const project = projects.find((p) => p.id === f.projectId);
  const projectSetup = useProjectSlicing(f.projectId).data;

  // Slices made here are merged in as they come, and saved with the plates.
  const toSlice = {
    projectId: f.projectId || null,
    plates: f.plates.filter((p) => !p.result).map(({ result: _, ...setup }) => setup),
  };
  const slice = useQuoteSlice(toSlice);
  const sliceOf = (p: { file: string; plate: number }) =>
    slice.data?.plates.find((s) => plateKey(s) === plateKey(p));
  const plates: QuotePlate[] = f.plates.map((p) => ({
    ...p,
    result: p.result ?? sliceOf(p)?.result ?? null,
  }));
  const left = toSlice.plates.filter((p) => sliceOf(p)?.job).length;
  const unsliced = plates.filter((p) => !p.result).length;
  // Files picked (a project's plates, or uploads): they are the print. Else it's typed in.
  const byHand = !plates.length && !f.uploads.length;
  const changePicked = (next: PlateSetupInput[]) => {
    const keys = new Set(next.map(plateKey));
    const gone = plates.filter((p) => !keys.has(plateKey(p)));
    const remembered = [...gone, ...unticked, ...(projectSetup ? fromProject(projectSetup) : [])];
    setUnticked([...gone, ...unticked]);
    set({ plates: changePlates(next, plates, remembered) });
  };

  // A project brings its saved setup (plates, printers, profiles, filaments) and its slices.
  const pickProject = (id: string) => {
    setF((cur) => ({
      ...cur,
      projectId: id,
      plates: cur.plates.filter((p) => isUpload(p.file)),
    }));
    if (!id) return;
    void qc
      .fetchQuery({
        queryKey: ["projects", id, "slicing"],
        queryFn: () => api<ProjectSlicing>("GET", `/api/projects/${id}/slicing`),
      })
      .then((s) =>
        setF((cur) =>
          cur.projectId === id ? { ...cur, plates: [...fromProject(s), ...cur.plates] } : cur,
        ),
      );
  };
  const addFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const u = await upload.mutateAsync(file).catch(() => null);
      if (u)
        setF((cur) =>
          cur.uploads.some((x) => x.id === u.id) ? cur : { ...cur, uploads: [...cur.uploads, u] },
        );
    }
  };
  const removeUpload = (u: QuoteUpload) =>
    set({
      uploads: f.uploads.filter((x) => x.id !== u.id),
      plates: plates.filter((p) => p.file !== u.model.file),
    });

  // One print: every plate on its own printer, or the print typed in when there are no files.
  const fallback = ctx.printers.find((p) => p.id === defaultPrinterId) ?? ctx.printers[0];
  const platesCost = estimateSlicedPlates(plates, ctx, {
    spools,
    profiles,
    fallbackPrinterId: fallback?.id,
  }).cost;
  const durationSec = f.minutes * 60;
  const typedCost = computeCost(
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
  const cost = byHand ? typedCost : platesCost;
  const quote = computeQuote(cost.total, {
    laborHours: f.laborHours,
    laborRatePerHour: toMinor(f.laborRate),
    failureMarginPct: f.failureMarginPct,
    markupPct: f.markupPct,
    quantity: Math.max(1, Math.round(f.quantity)),
  });
  const body = {
    name,
    notes,
    clientId: clientId || null,
    projectId: f.projectId || null,
    form: { ...f, plates },
    cost,
    quote,
  };
  const sliceStatus =
    slice.data && !slice.data.canSlice
      ? t("projects:slicing.noSlicer")
      : left
        ? t("projects:slicing.progress", { count: left })
        : runSlice.isError
          ? t("projects:slicing.startFailed")
          : plates.length && !unsliced
            ? t("projects:slicing.upToDate")
            : t("costs:form.sliceHint");
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
                onChange={pickProject}
                options={[
                  { value: "", label: t("costs:form.noProject") },
                  ...projects.map((p) => ({ value: p.id, label: projectName(t, p) })),
                ]}
              />
            </label>
            <Num
              label={t("costs:form.quantity")}
              value={f.quantity}
              onChange={(n) => set({ quantity: n ?? 1 })}
            />
          </div>

          <h3 className="font-medium">{t("costs:form.plates")}</h3>
          <p className="-mt-2 text-muted">{t("costs:form.platesHint")}</p>
          {f.uploads.length > 0 && (
            <ul className="grid gap-1">
              {f.uploads.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-all">{u.name}</span>
                  <Button
                    variant="ghost"
                    aria-label={t("costs:form.removeFile", { name: u.name })}
                    onClick={() => removeUpload(u)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {(project?.meta.models.length || f.uploads.length) > 0 && (
            <SliceSetup
              files={[
                ...(project?.meta.models ?? []).map((m) => ({
                  path: m.file,
                  label: m.file,
                  plates: m.plates,
                  printerModel: m.printerModel,
                  nozzleDiameter: m.nozzleDiameter,
                  printProfile: m.printProfile,
                  thumbnailUrl: (entry: string) => projectFileUrl(project?.id ?? "", m.file, entry),
                })),
                ...f.uploads.map((u) => ({
                  path: u.model.file,
                  label: u.name,
                  plates: u.model.plates,
                  printerModel: u.model.printerModel,
                  nozzleDiameter: u.model.nozzleDiameter,
                  printProfile: u.model.printProfile,
                  thumbnailUrl: (entry: string) => quoteFileUrl(u.id, entry),
                })),
              ]}
              value={plates}
              onChange={changePicked}
              defaultPrinterId={defaultPrinterId}
              plateInfo={(key) => {
                const p = plates.find((x) => plateKey(x) === key);
                const s = p && sliceOf(p);
                return (
                  p && (
                    <PlateSlice
                      plate={{
                        job: p.result ? null : (s?.job ?? null),
                        result: p.result,
                        error: p.result ? null : (s?.error ?? null),
                        needsSlicing: !p.result,
                      }}
                    />
                  )
                );
              }}
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2 focus-within:ring-2 focus-within:ring-accent ${upload.isPending ? "opacity-60" : ""}`}
            >
              <Upload className="size-4" aria-hidden />
              {upload.isPending ? t("costs:form.uploading") : t("costs:form.addFile")}
              <input
                type="file"
                accept=".3mf"
                multiple
                className="sr-only"
                disabled={upload.isPending}
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              disabled={!unsliced || !!left || runSlice.isPending || slice.data?.canSlice === false}
              onClick={() => runSlice.mutate(toSlice)}
            >
              {t("projects:slicing.slice")}
            </Button>
            {plates.length > 0 && (
              <p aria-live="polite" className={runSlice.isError ? "text-bad" : "text-muted"}>
                {sliceStatus}
              </p>
            )}
          </div>
          {upload.isError && (
            <p role="alert" className="text-bad">
              {t("costs:form.uploadFailed")}
            </p>
          )}

          {byHand ? (
            <ByHand ctx={ctx} f={f} set={set} />
          ) : (
            <p className="text-muted">{t("costs:form.byHandHidden")}</p>
          )}
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

function LoadError() {
  const { t } = useTranslation();
  return (
    <p role="alert" className="text-bad">
      {t("costs:loadError")}
    </p>
  );
}

export function QuoteCreatePage() {
  const { t } = useTranslation();
  const { data, isError } = useCostContext();
  return (
    <>
      <PageHeader title={t("costs:saved.new")} backTo={{ to: "/quotes" }} />
      {isError && <LoadError />}
      {data && <QuoteForm ctx={data} />}
    </>
  );
}

export function QuoteEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const ctx = useCostContext();
  const quote = useQuote(id);
  if (quote.isError)
    return (
      <>
        <PageHeader title={t("nav:items.quotes.label")} backTo={{ to: "/quotes" }} />
        <p role="alert" className="text-bad">
          {t("costs:saved.notFound")}
        </p>
      </>
    );
  return (
    <>
      <PageHeader
        title={quote.data ? quoteName(t, quote.data) : ""}
        backTo={{ to: "/quotes" }}
        actions={
          <Link
            to={`/orders/new?${new URLSearchParams({ quoteId: id })}` as LinkProps["to"]}
            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2"
          >
            <ClipboardList className="size-4" aria-hidden />
            {t("costs:saved.createOrder")}
          </Link>
        }
      />
      {ctx.isError && <LoadError />}
      {/* Remounts with each opened quote's saved values. */}
      {ctx.data && quote.data && (
        <QuoteForm key={quote.data.id} ctx={ctx.data} editing={quote.data} />
      )}
    </>
  );
}
