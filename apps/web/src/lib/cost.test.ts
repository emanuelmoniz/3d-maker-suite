import type { CostContext, FilamentProfile, PlateSetup, Spool } from "@3d-maker-suite/core";
import { expect, test } from "vitest";
import { estimateSlicedPlates } from "./cost.ts";

const ctx: CostContext = {
  rates: { energyPerKwh: 0 },
  quoteDefaults: { laborRatePerHour: 0, failureMarginPct: 0, markupPct: 0 },
  printers: [
    {
      id: "cheap",
      number: 1,
      name: "Cheap",
      powerW: null,
      wearPerHour: 100,
      maintenancePerHour: 0,
    },
    { id: "dear", number: 2, name: "Dear", powerW: null, wearPerHour: 300, maintenancePerHour: 0 },
  ],
  materialPrices: { PLA: 2000, PETG: 3000 },
};
const profile = (id: string, material: string, pricePerKg: number | null) =>
  ({ id, material, pricePerKg }) as FilamentProfile;
const spool = (id: string, profileId: string, pricePaid: number | null) =>
  ({ id, profileId, pricePaid, initialGrams: 1000 }) as Spool;
const plate = (p: Partial<PlateSetup>, grams: [number, number, string][]): PlateSetup =>
  ({
    printerId: null,
    filaments: [],
    spools: [],
    result: {
      printTimeSeconds: 3600,
      weightGrams: 0,
      filaments: grams.map(([slot, g, material]) => ({ slot, grams: g, material })),
      slicedAt: "2026-10-19T00:00:00.000Z",
    },
    ...p,
  }) as PlateSetup;

test("prices each slot by spool, then profile, then material average, on each plate's printer", () => {
  const profiles = [profile("pla", "PLA", 1000)];
  const red = spool("red", "pla", 5000); // 5 €/kg paid
  const out = estimateSlicedPlates(
    [
      // 100 g from the spool (5000/kg) + 100 g from the profile (1000/kg), 1 h on "dear".
      plate({ printerId: "dear", spools: ["red"], filaments: ["pla", "pla"] }, [
        [1, 100, "PLA"],
        [2, 100, "PLA"],
      ]),
      // 100 g of the file's PETG: the PETG average (3000/kg), 1 h on the fallback "cheap".
      plate({}, [[1, 100, "PETG"]]),
      // Not sliced: left out.
      { ...plate({}, []), result: null },
    ],
    ctx,
    { spools: [red], profiles, fallbackPrinterId: "cheap" },
  );
  expect(out.cost.material).toBe(500 + 100 + 300);
  expect(out.cost.wear).toBe(300 + 100);
  expect(out.spools).toEqual([{ spool: red, grams: 100 }]);
  expect(out.materials).toEqual([
    { material: "PLA", grams: 200 },
    { material: "PETG", grams: 100 },
  ]);
});
