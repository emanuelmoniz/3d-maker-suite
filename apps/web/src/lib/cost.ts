import {
  type CostBreakdown,
  type CostContext,
  type CostRates,
  computeCost,
  estimateEnergyWh,
  type FilamentProfile,
  type PlateSetup,
  type PlateSetupInput,
  type ProjectModel,
  type Quote,
  type QuoteInput,
  type QuotePatch,
  type QuoteSlice,
  type QuoteSliceInput,
  type QuoteUpload,
  type SliceResultInfo,
  type Spool,
  spoolPricePerKg,
  sumCosts,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import type { ListQuery } from "../components/DataTable.tsx";
import { api } from "./api.ts";
import { formatCurrency } from "./format.ts";
import { useListPage } from "./list.ts";
import { usePreferences } from "./preferences.ts";

export const useCostContext = () =>
  useQuery({
    queryKey: ["costs", "context"],
    queryFn: () => api<CostContext>("GET", "/api/costs/context"),
  });

/** `query` is the table's list query plus any fixed filter (`clientId`, `projectId`). */
export const useQuotes = (query: ListQuery) =>
  useListPage<Quote>(["costs", "quotes", "list"], "/api/costs/quotes", query);

export const useQuote = (id: string | undefined) =>
  useQuery({
    queryKey: ["costs", "quotes", id],
    queryFn: () => api<Quote>("GET", `/api/costs/quotes/${id}`),
    enabled: !!id,
  });

function useQuoteMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["costs", "quotes"] }),
  });
}
export const useSaveQuote = () =>
  useQuoteMutation((v: QuoteInput) => api<Quote>("POST", "/api/costs/quotes", v));
export const usePatchQuote = () =>
  useQuoteMutation((v: QuotePatch & { id: string }) => {
    const { id, ...patch } = v;
    return api<Quote>("PATCH", `/api/costs/quotes/${id}`, patch);
  });
export const useDeleteQuote = () =>
  useQuoteMutation((id: string) => api("DELETE", `/api/costs/quotes/${id}`));

/** Uploads a .3mf for the calculator (outside any project). */
export const useUploadQuoteFile = () =>
  useMutation({
    mutationFn: (file: File) =>
      api<QuoteUpload>(
        "POST",
        `/api/costs/files?${new URLSearchParams({ name: file.name })}`,
        new Blob([file], { type: "application/octet-stream" }),
      ),
  });

/** A plate preview inside an uploaded 3MF. */
export const quoteFileUrl = (id: string, entry: string) =>
  `/api/costs/files/${id}?${new URLSearchParams({ entry })}`;

/** The calculator plates' slices (results, errors, jobs). Polls while some are being sliced. */
export const useQuoteSlice = (body: Omit<QuoteSliceInput, "run">) =>
  useQuery({
    queryKey: ["costs", "slice", body],
    queryFn: () => api<QuoteSlice>("POST", "/api/costs/slice", { ...body, run: false }),
    enabled: body.plates.length > 0,
    refetchInterval: (q) => (q.state.data?.plates.some((p) => p.job) ? 1000 : false),
  });

/** Queues the plates without a result; progress comes from `useQuoteSlice`. */
export const useRunQuoteSlice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<QuoteSliceInput, "run">) =>
      api<QuoteSlice>("POST", "/api/costs/slice", { ...body, run: true }),
    onSuccess: (data, body) => qc.setQueryData(["costs", "slice", body], data),
  });
};

/** The name a quote goes by everywhere: "001-Vase". The server builds the same in `quoteLabel`. */
export const quoteName = (t: TFunction, q: Pick<Quote, "number" | "name">) =>
  t("common:quoteName", { number: String(q.number).padStart(3, "0"), name: q.name });

/** Formats minor units in the configured currency. */
export function useMoney() {
  const currency = usePreferences().data?.values.currency;
  return (minor: number) => formatCurrency(minor / 100, currency);
}

export type Plate = ProjectModel["plates"][number];

/** Price per kg of a material from the profiles on hand (minor units), or null. */
export const materialPrice = (ctx: CostContext, type: string | null) =>
  (type && ctx.materialPrices[type.toUpperCase()]) || null;

function printerRates(printerId: string | undefined, ctx: CostContext) {
  const printer = ctx.printers.find((p) => p.id === printerId);
  const rates: CostRates = {
    energyPerKwh: ctx.rates.energyPerKwh,
    wearPerHour: printer?.wearPerHour ?? 0,
    maintenancePerHour: printer?.maintenancePerHour ?? 0,
  };
  return { printer, rates };
}

/** The cost of printing a sliced 3MF plate on a printer, before anything is printed. */
export function estimatePlate(plate: Plate, printerId: string | undefined, ctx: CostContext) {
  const { printer, rates } = printerRates(printerId, ctx);
  return computeCost(
    {
      durationSec: plate.printTimeSeconds,
      energyWh: estimateEnergyWh(printer?.powerW ?? null, plate.printTimeSeconds),
      filaments: plate.filaments
        .filter((f) => f.grams != null)
        .map((f) => ({ grams: f.grams as number, pricePerKg: materialPrice(ctx, f.type) })),
    },
    rates,
  );
}

/** A plate on a quote: its slicing setup, and its slice once there is one. */
export type QuotePlate = PlateSetupInput & { result: SliceResultInfo | null };

// What a slice depends on; a spool of the same profile only changes the price. Quotes saved
// before slicer picks have no `slicerIntegrationId`.
const slicedWith = (p: PlateSetupInput) =>
  JSON.stringify([
    p.printerId,
    p.printProfileId,
    p.useDefaultPrintProfile,
    p.filaments,
    p.slicerIntegrationId ?? null,
  ]);

const samePlate = (a: { file: string; plate: number }) => (b: { file: string; plate: number }) =>
  a.file === b.file && a.plate === b.plate;

/** The plates as `SliceSetup` left them; each keeps its slice if it still slices the same. */
export function keepResults(next: PlateSetupInput[], prev: QuotePlate[]): QuotePlate[] {
  return next.map((v) => {
    const was = prev.find(samePlate(v));
    return { ...v, result: was && slicedWith(was) === slicedWith(v) ? was.result : null };
  });
}

/**
 * The quote's plates after a change in `SliceSetup`. A plate ticked again gets back the setup it
 * had (`remembered`: plates unticked here, then the project's saved setup) instead of the
 * defaults, so it keeps its slice; a file ticked again gets back the plates it had, not all of
 * them. Every plate keeps its slice while it slices the same.
 */
export function changePlates(
  next: PlateSetupInput[],
  current: QuotePlate[],
  remembered: QuotePlate[],
): QuotePlate[] {
  const backAgain = (file: string) =>
    !current.some((p) => p.file === file) && remembered.some((p) => p.file === file);
  const restored = next
    .filter((v) => !backAgain(v.file) || remembered.some(samePlate(v)))
    .map((v) => (current.some(samePlate(v)) ? v : (remembered.find(samePlate(v)) ?? v)));
  return keepResults(restored, [...current, ...remembered]);
}

export type SlicedEstimate = {
  cost: CostBreakdown;
  /** Grams per picked spool, over all plates, in the order first used. */
  spools: { spool: Spool; grams: number }[];
  /** Grams per material (upper case), spools or not. */
  materials: { material: string; grams: number }[];
};

/**
 * One print of a project: its sliced plates, each on its own printer (else `fallbackPrinterId`).
 * A slot costs its spool's price, else its filament profile's, else the material's average; its
 * material is the spool's or profile's, else the one the slicer reports.
 */
export function estimateSlicedPlates(
  plates: Pick<PlateSetup, "printerId" | "result" | "spools" | "filaments">[],
  ctx: CostContext,
  catalog: { spools: Spool[]; profiles: FilamentProfile[]; fallbackPrinterId?: string },
): SlicedEstimate {
  const spools = new Map<string, { spool: Spool; grams: number }>();
  const materials = new Map<string, number>();
  const costs = plates.flatMap((p) => {
    if (!p.result) return [];
    const { printer, rates } = printerRates(p.printerId ?? catalog.fallbackPrinterId, ctx);
    const seconds = p.result.printTimeSeconds;
    const filaments = p.result.filaments.map((f) => {
      const spool = catalog.spools.find((s) => s.id === p.spools[f.slot - 1]);
      const profileId = spool?.profileId ?? p.filaments[f.slot - 1];
      const profile = catalog.profiles.find((x) => x.id === profileId);
      const material = (profile?.material ?? f.material ?? "").toUpperCase();
      if (spool) {
        const seen = spools.get(spool.id) ?? { spool, grams: 0 };
        spools.set(spool.id, { spool, grams: seen.grams + f.grams });
      }
      if (material) materials.set(material, (materials.get(material) ?? 0) + f.grams);
      const own = profile && (spool ? spoolPricePerKg(spool, profile) : profile.pricePerKg);
      return { grams: f.grams, pricePerKg: own ?? materialPrice(ctx, material) };
    });
    return [
      computeCost(
        {
          durationSec: seconds,
          energyWh: estimateEnergyWh(printer?.powerW ?? null, seconds),
          filaments,
        },
        rates,
      ),
    ];
  });
  return {
    cost: sumCosts(costs),
    spools: [...spools.values()],
    materials: [...materials].map(([material, grams]) => ({ material, grams })),
  };
}
