import { describe, expect, it } from "vitest";
import {
  computeCost,
  computeQuote,
  estimateEnergyWh,
  maintenancePerHour,
  spoolPricePerKg,
  sumCosts,
  toMinor,
  wearPerHour,
} from "./cost.ts";

const rates = { energyPerKwh: 25, wearPerHour: 10, maintenancePerHour: 5 };

describe("rates", () => {
  it("converts and derives", () => {
    expect(toMinor(0.285)).toBe(29);
    expect(estimateEnergyWh(120, 3600)).toBe(120);
    expect(estimateEnergyWh(null, 3600)).toBeNull();
    expect(wearPerHour(60000, 3000)).toBe(20);
    expect(wearPerHour(60000, 0)).toBe(0);
    expect(wearPerHour(null, 3000)).toBe(0);
    expect(maintenancePerHour(1000, 36000)).toBe(100);
    expect(maintenancePerHour(1000, 0)).toBe(0);
  });

  it("prefers the price paid for the spool over the list price", () => {
    const list = { pricePerKg: 3000 };
    expect(spoolPricePerKg({ pricePaid: 1500, initialGrams: 750 }, list)).toBe(2000);
    expect(spoolPricePerKg({ pricePaid: null, initialGrams: 1000 }, list)).toBe(3000);
    expect(
      spoolPricePerKg({ pricePaid: null, initialGrams: 1000 }, { pricePerKg: null }),
    ).toBeNull();
  });
});

describe("computeCost", () => {
  it("splits a print into lines that add up", () => {
    const c = computeCost(
      {
        durationSec: 7200,
        energyWh: 400,
        filaments: [
          { grams: 100, pricePerKg: 2000 },
          { grams: 50, pricePerKg: 3000 },
        ],
      },
      rates,
    );
    expect(c).toEqual({
      material: 350,
      energy: 10,
      wear: 20,
      maintenance: 10,
      total: 390,
      unpricedGrams: 0,
    });
  });

  it("flags filament without a price instead of guessing", () => {
    const c = computeCost(
      { durationSec: null, energyWh: null, filaments: [{ grams: 80, pricePerKg: null }] },
      rates,
    );
    expect(c).toMatchObject({ material: 0, total: 0, unpricedGrams: 80 });
  });

  it("sums breakdowns", () => {
    const a = computeCost({ durationSec: 3600, energyWh: 0, filaments: [] }, rates);
    expect(sumCosts([a, a]).total).toBe(2 * a.total);
    expect(sumCosts([]).total).toBe(0);
  });
});

describe("computeQuote", () => {
  it("adds labor, failure margin and markup in order, times quantity", () => {
    const q = computeQuote(400, {
      laborHours: 0.5,
      laborRatePerHour: 1000,
      failureMarginPct: 10,
      markupPct: 20,
      quantity: 3,
    });
    // labor 500, base 900, failure 90, subtotal 990, markup 198
    expect(q).toEqual({
      unitCost: 400,
      labor: 500,
      failureMargin: 90,
      subtotal: 990,
      markup: 198,
      unitPrice: 1188,
      quantity: 3,
      total: 3564,
    });
  });

  it("with no extras the price is the cost", () => {
    const none = { laborHours: 0, laborRatePerHour: 0, failureMarginPct: 0, markupPct: 0 };
    expect(computeQuote(123, { ...none, quantity: 1 }).total).toBe(123);
  });
});
