import type { CostContext, FilamentPreset, PlateSetup, Spool } from "@3d-maker-suite/core";
import { expect, test } from "vitest";
import { changePlates, estimateSlicedPlates, keepResults } from "./cost.ts";

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
const preset = (id: string, material: string) => ({ id, material }) as FilamentPreset;
const spool = (id: string, material: string, pricePaid: number | null) =>
  ({ id, material, pricePaid, initialGrams: 1000 }) as Spool;
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

test("prices each slot by its spool, else its material, on each plate's printer", () => {
  const presets = [preset("pla", "PLA"), preset("petg", "PETG")];
  const red = spool("red", "PLA", 5000); // 5 €/kg paid
  const unpaid = spool("unpaid", "PETG", null);
  const out = estimateSlicedPlates(
    [
      // 100 g from the spool (5000/kg) + 100 g of the slot preset's PLA (2000/kg), 1 h on "dear".
      plate({ printerId: "dear", spools: ["red"], filaments: ["pla", "pla"] }, [
        [1, 100, "PLA"],
        [2, 100, "PETG"],
      ]),
      // A spool with no price paid: its own material's (PETG, 3000/kg), whatever the slot says.
      plate({ printerId: "dear", spools: ["unpaid"] }, [[1, 100, "PLA"]]),
      // 100 g of the file's PETG: the PETG average (3000/kg), 1 h on the fallback "cheap".
      plate({}, [[1, 100, "PETG"]]),
      // Not sliced: left out.
      { ...plate({}, []), result: null },
    ],
    ctx,
    { spools: [red, unpaid], presets, fallbackPrinterId: "cheap" },
  );
  expect(out.cost.material).toBe(500 + 200 + 300 + 300);
  expect(out.cost.wear).toBe(300 + 300 + 100);
  expect(out.spools).toEqual([
    { spool: red, grams: 100 },
    { spool: unpaid, grams: 100 },
  ]);
  expect(out.materials).toEqual([
    { material: "PLA", grams: 200 },
    { material: "PETG", grams: 200 },
  ]);
});

test("a quote plate keeps its slice while it slices the same, and loses it when not", () => {
  const setup = {
    file: "a.3mf",
    plate: 1,
    printerId: "dear",
    machinePresetId: null,
    processPresetId: null,
    useDefaultProcessPreset: false,
    filaments: ["pla"],
    spools: [],
    kept: [],
    slicerIntegrationId: null,
  };
  const sliced = { ...setup, result: plate({}, [[1, 10, "PLA"]]).result };
  // Another spool of the same preset: same slice. Another preset, slicer or plate: none.
  expect(keepResults([{ ...setup, spools: ["red"] }], [sliced])[0]?.result).toBe(sliced.result);
  expect(keepResults([{ ...setup, processPresetId: "fine" }], [sliced])[0]?.result).toBeNull();
  expect(keepResults([{ ...setup, slicerIntegrationId: "orca" }], [sliced])[0]?.result).toBeNull();
  expect(keepResults([{ ...setup, plate: 2 }], [sliced])[0]?.result).toBeNull();
});

test("a plate ticked again gets back its own setup and slice, not the defaults", () => {
  const saved = {
    file: "a.3mf",
    plate: 1,
    printerId: "dear",
    machinePresetId: null,
    processPresetId: null,
    useDefaultProcessPreset: false,
    filaments: ["pla", null],
    spools: ["red", null],
    kept: [],
    slicerIntegrationId: null,
    result: plate({}, [[1, 10, "PLA"]]).result,
  };
  // What SliceSetup builds for a freshly ticked plate: filaments by name, no spools.
  const defaults = { ...saved, filaments: ["other"], spools: [] };
  const { result: _, ...fresh } = defaults;
  const [back] = changePlates([fresh], [], [saved]);
  expect(back).toEqual(saved);
  // The whole file ticked again: only the plates it had come back.
  const other = { ...fresh, plate: 2 };
  expect(changePlates([fresh, other], [], [saved])).toEqual([saved]);
  // A file never picked before: every plate it ticks.
  expect(changePlates([fresh, other], [], [])).toHaveLength(2);
  // Still ticked and then changed: the change stays, and the slice goes.
  const [changed] = changePlates([{ ...fresh, filaments: ["other"] }], [saved], [saved]);
  expect(changed).toMatchObject({ filaments: ["other"], result: null });
});
