import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readJobTotals } from "./jobTotals.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/job-headers/${name}`, import.meta.url)));

describe("readJobTotals (fixtures/job-headers)", () => {
  it("OrcaSlicer: the end of the G-code, per tool", async () => {
    expect(await readJobTotals(fixture("orcaslicer-klipper.gcode"))).toEqual([
      { slot: 0, grams: 0.99 },
    ]);
  });
  it("PrusaSlicer G-code", async () => {
    expect(await readJobTotals(fixture("prusaslicer-klipper.gcode"))).toEqual([
      { slot: 0, grams: 1.2 },
    ]);
  });
  it("PrusaSlicer .bgcode", async () => {
    expect(await readJobTotals(fixture("prusaslicer.bgcode"))).toEqual([{ slot: 0, grams: 1.2 }]);
  });
  it("Bambu Studio G-code: only the filaments used, no slot", async () => {
    expect(await readJobTotals(fixture("bambu-studio-4-filaments.gcode.head"))).toEqual([
      { grams: 98.33 },
      { grams: 10.09 },
      { grams: 9.7 },
      { grams: 6.6 },
    ]);
    expect(await readJobTotals(fixture("bambu-studio-1-filament.gcode.head"))).toHaveLength(1);
  });
  it("Bambu Studio .gcode.3mf: slice_info.config, with the slot", async () => {
    expect(await readJobTotals(fixture("bambu-studio.gcode.3mf"))).toEqual([
      { slot: 3, grams: 18.73 },
    ]);
  });
  it("a file with no totals gives none", async () => {
    expect(await readJobTotals(new TextEncoder().encode("G28\nG1 X1\n"))).toEqual([]);
  });
});
