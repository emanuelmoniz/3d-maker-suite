import {
  type CostContext,
  type CostRates,
  computeCost,
  estimateEnergyWh,
  type ProjectModel,
  type Quote,
  type QuoteInput,
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

/** The cost of printing a sliced 3MF plate on a printer, before anything is printed. */
export function estimatePlate(plate: Plate, printerId: string | undefined, ctx: CostContext) {
  const printer = ctx.printers.find((p) => p.id === printerId);
  const rates: CostRates = {
    energyPerKwh: ctx.rates.energyPerKwh,
    wearPerHour: printer?.wearPerHour ?? 0,
    maintenancePerHour: printer?.maintenancePerHour ?? 0,
  };
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
