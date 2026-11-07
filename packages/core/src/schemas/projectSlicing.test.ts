import { describe, expect, it } from "vitest";
import {
  foreignFilaments,
  pickSlicer,
  presetMisfit,
  resolvePlate,
  slotAdvice,
  spoolPresets,
} from "./projectSlicing.ts";

describe("resolvePlate", () => {
  const machine = (id: string, model: string, nozzle: number, lib = "bambu-studio") => ({
    id,
    printerModelId: model,
    nozzleDiameterMm: nozzle,
    sourcePreset: `${lib}:system/${id}`,
    defaultPrintPreset: `${lib}:system/${id} std`,
    archivedAt: null,
  });
  const print = (id: string, model: string | null, machines: string[] = [], source = id) => ({
    id,
    printerModelId: model,
    sourcePreset: `bambu-studio:system/${source}`,
    machinePresets: machines.map((m) => `bambu-studio:system/${m}`),
    archivedAt: null,
  });
  const a1 = { id: "a1", model: "A1", brand: "Bambu Lab", nozzleDiameterMm: 0.4, modelId: "A1" };
  const p1s = { ...a1, id: "p1s", model: "P1S", modelId: "P1S", machineProfileId: "p1s-04" };
  const myA1 = { ...a1, machineProfileId: "a1-04", printProfileId: null as string | null };
  const ctx = {
    printers: [myA1, { ...p1s, printProfileId: "fine" }],
    defaultPrinterId: null,
    machines: [
      machine("a1-04", "A1", 0.4),
      machine("a1-06", "A1", 0.6),
      machine("p1s-04", "P1S", 0.4),
      machine("p1s-orca", "P1S", 0.4, "orca-slicer"),
    ],
    prints: [
      print("fine", "P1S", ["p1s-04"]),
      print("std-a1", "A1", ["a1-04"], "a1-04 std"),
      print("std-p1s", "P1S", ["p1s-04"], "p1s-04 std"),
      print("old", "A1"), // read before compatible_printers were kept
    ],
    library: "bambu-studio",
  };
  const file = { printerModel: "Bambu Lab A1", nozzleDiameter: 0.4 };
  const plate = {
    printerId: null,
    machineProfileId: null,
    printProfileId: null,
    useDefaultPrintProfile: false,
  };

  it("slices as saved in the file on the file's printer", () => {
    const r = resolvePlate(plate, file, ctx);
    expect([r.printer?.id, r.fromFile, r.machine?.id, r.profileId]).toEqual([
      "a1",
      true,
      "a1-04",
      null,
    ]);
    expect(r.machines.map((m) => m.id)).toEqual(["a1-04", "a1-06"]); // every nozzle, one slicer
    // The default on request: the machine's, as the printer has none.
    expect(resolvePlate({ ...plate, useDefaultPrintProfile: true }, file, ctx).profileId).toBe(
      "std-a1",
    );
  });

  it("another printer takes its machine profile and its default print profile", () => {
    const r = resolvePlate({ ...plate, printerId: "p1s" }, file, ctx);
    expect([r.fromFile, r.machine?.id, r.profileId]).toEqual([false, "p1s-04", "fine"]);
    // In another slicer, that slicer's machine for the printer's nozzle.
    const orca = resolvePlate({ ...plate, printerId: "p1s" }, file, {
      ...ctx,
      library: "orca-slicer",
    });
    expect(orca.machine?.id).toBe("p1s-orca");
  });

  it("a printer default that doesn't fit the machine gives way to the machine's", () => {
    const x1c = print("fine", "X1C", ["x1c"]);
    const other = { ...ctx, prints: ctx.prints.map((p) => (p.id === "fine" ? x1c : p)) };
    expect(resolvePlate({ ...plate, printerId: "p1s" }, file, other).profileId).toBe("std-p1s");
    // A profile read before compatible_printers were kept fits its model.
    const old = { ...ctx, printers: [{ ...myA1, printProfileId: "old" }] };
    expect(resolvePlate({ ...plate, useDefaultPrintProfile: true }, file, old).profileId).toBe(
      "old",
    );
  });

  it("a picked machine (a nozzle swap) is never the file's", () => {
    const r = resolvePlate({ ...plate, machineProfileId: "a1-06" }, file, ctx);
    expect([r.fits, r.fromFile, r.machine?.id]).toEqual([true, false, "a1-06"]);
    expect(r.profileId).toBe(null); // a1-06 names no print profile we have, the A1 none
    expect(
      resolvePlate({ ...plate, machineProfileId: "a1-06", printProfileId: "std-a1" }, file, ctx)
        .profileId,
    ).toBe("std-a1");
  });
});

it("picks the plate's slicer, then the project's, the default, the first", () => {
  const capable = ["a", "b", "c"];
  expect(pickSlicer(capable, ["c", "b", "a"])).toBe("c");
  expect(pickSlicer(capable, [null, "b", "a"])).toBe("b");
  expect(pickSlicer(capable, ["off", "b", "a"])).toBe("b"); // removed or switched off: skipped
  expect(pickSlicer(capable, ["off", undefined, "c"])).toBe("c");
  expect(pickSlicer(capable, [null, null, "off"])).toBe("a");
  expect(pickSlicer([], ["a"])).toBeUndefined();
});

describe("presetMisfit", () => {
  const bambu = (name: string) => ({ name, sourcePreset: `bambu-studio:system/${name}` });
  const orca = (name: string) => ({ name, sourcePreset: `orca-slicer:user/${name}` });
  const handMade = (name: string) => ({ name, sourcePreset: null });

  it("fits a slicer of the presets' library", () => {
    const plate = { print: bambu("0.20mm"), machines: [bambu("A1")] };
    expect(presetMisfit("bambu-studio", plate)).toBeUndefined();
    expect(presetMisfit("orca-slicer", plate)).toBe("0.20mm");
  });

  it("names the printer when none of its machine presets is the slicer's", () => {
    const plate = { machines: [bambu("A1"), handMade("Mine")], printer: "My A1" };
    expect(presetMisfit("bambu-studio", plate)).toBeUndefined();
    expect(presetMisfit("orca-slicer", plate)).toBe("My A1");
  });

  it("refuses any hand-made process; filaments never block", () => {
    expect(presetMisfit("bambu-studio", { print: handMade("Mine") })).toBe("Mine");
    expect(presetMisfit("bambu-studio", {})).toBeUndefined();
  });

  it("lists another slicer's filaments, not hand-made or own ones", () => {
    const list = [bambu("PLA"), handMade("Cheap"), orca("Silk")];
    expect(foreignFilaments("bambu-studio", list).map((f) => f.name)).toEqual(["Silk"]);
    expect(foreignFilaments("orca-slicer", list).map((f) => f.name)).toEqual(["PLA"]);
  });
});

describe("a spool's presets", () => {
  const preset = (brand: string, material: string, name: string, scope = "system") => ({
    id: name,
    brand,
    material,
    name,
    sourcePreset: `bambu-studio:${scope}/${name}`,
  });
  const basic = preset("Bambu Lab", "PLA", "Bambu PLA Basic");
  const matte = preset("Bambu Lab", "PLA", "Bambu PLA Matte");
  const petg = preset("Bambu Lab", "PETG", "Bambu PETG Basic");
  const generic = preset("Generic", "PLA", "Generic PLA");
  const presets = [matte, basic, petg, generic];
  const spool = (brand: string, material: string, name: string | null) => ({
    brand,
    material,
    name,
  });
  const ids = (r: ReturnType<typeof spoolPresets>) => r && [r.level, r.presets.map((p) => p.id)];

  it("finds brand + material + name, then brand + material, then Generic", () => {
    const named = spoolPresets(spool("Bambu Lab", "PLA", "PLA Basic"), presets);
    expect(ids(named)).toEqual(["name", ["Bambu PLA Basic"]]);
    expect(named?.best).toBe(basic);
    const branded = spoolPresets(spool("bambu lab", "pla", "PLA Tough"), presets);
    expect(ids(branded)).toEqual(["brand", ["Bambu PLA Matte", "Bambu PLA Basic"]]);
    expect(branded?.best).toBeUndefined(); // several: they head the picker, nothing is guessed
    const other = spoolPresets(spool("Acme", "PLA", "Silk"), presets);
    expect(ids(other)).toEqual(["generic", ["Generic PLA"]]);
    expect(other?.best).toBe(generic);
    expect(spoolPresets(spool("Acme", "ASA", null), presets)).toBeUndefined();
  });

  it("reads a spool without a name as its material, one without a brand as Generic", () => {
    const plain = preset("Bambu Lab", "PLA", "Bambu PLA");
    expect(spoolPresets(spool("Bambu Lab", "PLA", null), [...presets, plain])?.best).toBe(plain);
    expect(spoolPresets(spool("", "PLA", "PLA Basic"), presets)?.level).toBe("generic");
  });

  it("puts the user's own presets first on a level", () => {
    const mine = preset("Bambu Lab", "PLA", "My PLA", "user");
    const r = spoolPresets(spool("Bambu Lab", "PLA", "PLA Tough"), [...presets, mine]);
    expect(ids(r)).toEqual(["brand", ["My PLA", "Bambu PLA Matte", "Bambu PLA Basic"]]);
    expect(r?.best).toBe(mine);
  });

  describe("what a slot says about its preset", () => {
    const bambuBasic = spool("Bambu Lab", "PLA", "PLA Basic");
    const on = (id: string) => ({ id, name: null, material: null });

    it("nothing when the preset is already on the spool's best level", () => {
      expect(slotAdvice(bambuBasic, on("Bambu PLA Basic"), presets)).toBeUndefined();
      const fromFile = { id: null, name: "Bambu PLA Basic @BBL X1C", material: "PLA" };
      expect(slotAdvice(bambuBasic, fromFile, presets)).toBeUndefined();
      // No preset has the spool's name: any of its brand and material fits.
      const tough = spool("Bambu Lab", "PLA", "PLA Tough");
      expect(slotAdvice(tough, on("Bambu PLA Matte"), presets)).toBeUndefined();
    });

    it("a suggestion for the preset of the spool's name over another of its brand", () => {
      const pure = preset("Bambu Lab", "PLA", "Bambu PLA Pure");
      const fromFile = { id: null, name: "Bambu PLA Pure @BBL A1", material: "PLA" };
      const matteSpool = spool("Bambu Lab", "PLA", "PLA Matte");
      expect(slotAdvice(matteSpool, fromFile, [...presets, pure])).toEqual({
        kind: "suggest",
        preset: matte,
      });
    });

    it("a quiet suggestion for the same material when a brand match exists", () => {
      expect(slotAdvice(bambuBasic, on("Generic PLA"), presets)).toEqual({
        kind: "suggest",
        preset: basic,
      });
      const fromFile = { id: null, name: "Generic PLA @BBL A1", material: "PLA" };
      expect(slotAdvice(bambuBasic, fromFile, presets)).toMatchObject({ preset: basic });
    });

    it("nothing for the same material without a brand match, or several of them", () => {
      expect(slotAdvice(spool("Acme", "PLA", "Silk"), on("Generic PLA"), presets)).toBeUndefined();
      const tough = spool("Bambu Lab", "PLA", "PLA Tough");
      expect(slotAdvice(tough, on("Generic PLA"), presets)).toBeUndefined();
    });

    it("nothing for the same material when the file's preset isn't in the catalog", () => {
      const tuned = { id: null, name: "My PLA tuned @BBL X1C", material: "PLA" };
      expect(slotAdvice(bambuBasic, tuned, presets)).toBeUndefined();
      expect(slotAdvice(bambuBasic, on("another slicer's"), presets)).toBeUndefined();
    });

    it("a warning with the best match for another material", () => {
      const r = slotAdvice(
        spool("Bambu Lab", "PETG", "PETG Basic"),
        on("Bambu PLA Basic"),
        presets,
      );
      expect(r).toEqual({ kind: "mismatch", preset: petg, presets: [petg] });
      const fromFile = { id: null, name: "Some PLA", material: "PLA" };
      expect(slotAdvice(spool("Bambu Lab", "PETG", null), fromFile, presets)).toMatchObject({
        kind: "mismatch",
        presets: [petg],
      });
    });

    it("a warning without a match when no preset has the spool's material", () => {
      expect(slotAdvice(spool("Acme", "ASA", null), on("Bambu PLA Basic"), presets)).toEqual({
        kind: "mismatch",
        preset: undefined,
        presets: [],
      });
    });
  });
});
