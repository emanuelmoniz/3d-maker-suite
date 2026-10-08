import type { CostBreakdown, CostRates, QuoteBreakdown, QuoteSettings } from "../schemas/cost.ts";

/** Money in preferences is in major units (0.25 EUR); everything computed is minor units. */
// "e2" shifts the decimal point as text: 0.285 * 100 is 28.499999... in floats.
export const toMinor = (major: number) => Math.round(Number(`${major}e2`));

export interface CostFilament {
  grams: number;
  /** Minor units per kg; null when unknown. */
  pricePerKg: number | null;
}

export interface CostInput {
  durationSec: number | null;
  /** Measured or estimated. Null when the print has none. */
  energyWh: number | null;
  filaments: CostFilament[];
}

export const estimateEnergyWh = (powerW: number | null, durationSec: number | null) =>
  powerW && durationSec ? (powerW * durationSec) / 3600 : null;

/** Purchase price over the hours the printer is expected to last. Off (0) without both numbers. */
export const wearPerHour = (purchasePrice: number | null, lifetimeHours: number) =>
  purchasePrice && lifetimeHours > 0 ? purchasePrice / lifetimeHours : 0;

/** Maintenance spend so far over the runtime so far. */
export const maintenancePerHour = (totalCost: number, runtimeSec: number) =>
  runtimeSec > 0 ? totalCost / (runtimeSec / 3600) : 0;

/** What a spool really cost per kg: its own price when known, else the profile's list price. */
export function spoolPricePerKg(
  spool: { pricePaid: number | null; initialGrams: number },
  profile: { pricePerKg: number | null },
): number | null {
  if (spool.pricePaid != null && spool.initialGrams > 0)
    return (spool.pricePaid / spool.initialGrams) * 1000;
  return profile.pricePerKg;
}

/** Each line is rounded on its own, so the lines always add up to the total shown. */
export function computeCost(input: CostInput, rates: CostRates): CostBreakdown {
  const hours = (input.durationSec ?? 0) / 3600;
  let material = 0;
  let unpricedGrams = 0;
  for (const f of input.filaments) {
    if (f.pricePerKg == null) unpricedGrams += f.grams;
    else material += (f.grams / 1000) * f.pricePerKg;
  }
  const line = {
    material: Math.round(material),
    energy: Math.round(((input.energyWh ?? 0) / 1000) * rates.energyPerKwh),
    wear: Math.round(hours * rates.wearPerHour),
    maintenance: Math.round(hours * rates.maintenancePerHour),
  };
  return {
    ...line,
    total: line.material + line.energy + line.wear + line.maintenance,
    unpricedGrams,
  };
}

/** Sums breakdowns (a list of prints, a project). */
export const sumCosts = (list: CostBreakdown[]): CostBreakdown =>
  list.reduce(
    (a, c) => ({
      material: a.material + c.material,
      energy: a.energy + c.energy,
      wear: a.wear + c.wear,
      maintenance: a.maintenance + c.maintenance,
      total: a.total + c.total,
      unpricedGrams: a.unpricedGrams + c.unpricedGrams,
    }),
    { material: 0, energy: 0, wear: 0, maintenance: 0, total: 0, unpricedGrams: 0 },
  );

/**
 * Price for a customer. Per piece: production cost + labor, plus the failure margin on that,
 * plus the markup on the lot. The total is the piece price times the quantity.
 */
export function computeQuote(unitCost: number, s: QuoteSettings): QuoteBreakdown {
  const labor = Math.round(s.laborHours * s.laborRatePerHour);
  const failureMargin = Math.round(((unitCost + labor) * s.failureMarginPct) / 100);
  const subtotal = unitCost + labor + failureMargin;
  const markup = Math.round((subtotal * s.markupPct) / 100);
  const unitPrice = subtotal + markup;
  return {
    unitCost,
    labor,
    failureMargin,
    subtotal,
    markup,
    unitPrice,
    quantity: s.quantity,
    total: unitPrice * s.quantity,
  };
}
