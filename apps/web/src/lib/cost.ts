import {
  type CostBreakdown,
  type CostContext,
  type CostRates,
  computeCost,
  estimateEnergyWh,
  type FilamentProfile,
  type PlateSetup,
  type ProjectModel,
  type Quote,
  type QuoteInput,
  type Spool,
  spoolPricePerKg,
  sumCosts,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import { formatCurrency } from "./format.ts";
import { usePreferences } from "./preferences.ts";

export const useCostContext = () =>
  useQuery({
    queryKey: ["costs", "context"],
    queryFn: () => api<CostContext>("GET", "/api/costs/context"),
  });

export const useQuotes = () =>
  useQuery({
    queryKey: ["costs", "quotes"],
    queryFn: () => api<Quote[]>("GET", "/api/costs/quotes"),
  });

function useQuoteMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["costs", "quotes"] }),
  });
}
export const useSaveQuote = () =>
  useQuoteMutation((v: QuoteInput) => api<Quote>("POST", "/api/costs/quotes", v));
export const useDeleteQuote = () =>
  useQuoteMutation((id: string) => api("DELETE", `/api/costs/quotes/${id}`));

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
  plates: PlateSetup[],
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
