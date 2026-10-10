import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectModel } from "@3d-maker-suite/core";
import { describe, expect, it } from "vitest";
import { mergeSlicedExports, scanFolder } from "./scanFolder.ts";

const plate = (index: number, seconds: number | null = null): ProjectModel["plates"][number] => ({
  index,
  name: null,
  sliced: seconds != null,
  slicedOnSave: seconds != null,
  printTimeSeconds: seconds,
  weightGrams: seconds != null ? 10 : null,
  filaments: [],
  multicolor: false,
  objects: [],
  thumbnail: null,
});
const model = (file: string, plates: ProjectModel["plates"]): ProjectModel => ({
  file,
  slicer: null,
  printerModel: null,
  nozzleDiameter: null,
  sliced: plates.some((p) => p.sliced),
  multicolor: false,
  plates,
  partColors: [],
});

describe("sliced exports", () => {
  it("fill the project file next to them and leave the list", () => {
    const out = mergeSlicedExports([
      model("a/foo.3mf", [plate(1), plate(2), plate(3)]),
      model("a/foo.gcode.3mf", [plate(1, 60)]),
      model("a/foo_plate_3.gcode.3mf", [plate(3, 90)]),
      model("a/foobar.gcode.3mf", [plate(1, 5)]), // not "foo" + a separator
      model("b/foo.gcode.3mf", [plate(2, 7)]), // other folder
    ]);
    expect(out.map((m) => m.file)).toEqual(["a/foo.3mf", "a/foobar.gcode.3mf", "b/foo.gcode.3mf"]);
    expect(out[0]?.sliced).toBe(true);
    expect(out[0]?.plates.map((p) => [p.sliced, p.printTimeSeconds, p.weightGrams])).toEqual([
      [true, 60, 10],
      [false, null, null],
      [true, 90, 10],
    ]);
  });

  it("are not picked as the project's main file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scan-"));
    try {
      // Not real 3MFs: the main file is picked by name and date, parsed or not.
      await writeFile(join(dir, "foo.3mf"), "x");
      await writeFile(join(dir, "foo.gcode.3mf"), "x");
      await utimes(join(dir, "foo.3mf"), new Date(1000), new Date(1000));
      expect((await scanFolder(dir)).mainFile).toBe(join(dir, "foo.3mf"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
