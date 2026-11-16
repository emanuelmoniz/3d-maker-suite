import { describe, expect, it } from "vitest";
import type { ExternalPrint } from "../schemas/integrations.ts";
import { fillGrams, materialShare } from "./jobGrams.ts";

const print = (outcome: ExternalPrint["outcome"], filaments: ExternalPrint["filaments"]) =>
  ({
    externalId: "1",
    printerExternalId: "p",
    title: "t",
    startedAt: "2026-11-14T11:25:04.000Z",
    outcome,
    filaments,
  }) satisfies ExternalPrint;

describe("fillGrams", () => {
  // Bambu fixture: the printer said 40% on layer 6 of 45; the job's file has 4.35 g.
  const job = { progress: 40, layer: 6, totalLayers: 45 };

  it("a print cancelled on layer 6 of 45 gets 6/45 of the file's grams, estimated", () => {
    const out = fillGrams(print("cancelled", [{ slot: 0 }]), job, {
      file: [{ slot: 0, grams: 4.35 }],
    });
    expect(out.filaments).toEqual([
      { slot: 0, grams: 0.58, gramsSource: "file", gramsEstimated: true },
    ]);
  });

  it("the percent only where there is no layer", () => {
    expect(materialShare({ progress: 40 })).toBe(0.4);
    expect(materialShare({ layer: 6, totalLayers: 45, progress: 40 })).toBeCloseTo(6 / 45);
    expect(materialShare({})).toBeUndefined();
  });

  it("a finished print takes the whole total, not estimated", () => {
    const out = fillGrams(
      print("success", [{ slot: 3 }]),
      {},
      { file: [{ slot: 3, grams: 18.73 }] },
    );
    expect(out.filaments).toEqual([{ slot: 3, grams: 18.73, gramsSource: "file" }]);
  });

  it("the plate answers when the file has no totals", () => {
    const out = fillGrams(print("success", [{ slot: 0 }]), {}, { plate: [{ slot: 0, grams: 7 }] });
    expect(out.filaments[0]).toMatchObject({ grams: 7, gramsSource: "plate" });
  });

  it("the file wins over the plate; the printer's grams over both", () => {
    const totals = { file: [{ slot: 0, grams: 1 }], plate: [{ slot: 0, grams: 2 }] };
    expect(fillGrams(print("success", [{ slot: 0 }]), {}, totals).filaments[0]?.gramsSource).toBe(
      "file",
    );
    const kept = fillGrams(print("failed", [{ slot: 0, grams: 0.23 }]), job, totals).filaments[0];
    expect(kept).toEqual({ slot: 0, grams: 0.23, gramsSource: "printer" });
  });

  it("a total without slots is matched by position", () => {
    const out = fillGrams(
      print("success", [{ slot: 2 }, { slot: 5 }]),
      {},
      {
        file: [{ grams: 98.33 }, { grams: 10.09 }],
      },
    );
    expect(out.filaments.map((f) => f.grams)).toEqual([98.33, 10.09]);
  });

  it("a stopped print with no progress, or a slot no total covers, is left alone", () => {
    const totals = { file: [{ slot: 0, grams: 4 }] };
    expect(fillGrams(print("cancelled", [{ slot: 0 }]), {}, totals).filaments).toEqual([
      { slot: 0 },
    ]);
    expect(fillGrams(print("success", [{ slot: 1 }]), {}, totals).filaments).toEqual([{ slot: 1 }]);
  });
});
