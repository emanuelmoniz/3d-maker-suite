import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectModel } from "@3d-maker-suite/core";
import { describe, expect, it } from "vitest";
import {
  descriptionOf,
  discoverFolders,
  folderDigest,
  mergeSlicedExports,
  scanFolder,
} from "./scanFolder.ts";

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
  items: [],
  thumbnail: null,
});
const model = (file: string, plates: ProjectModel["plates"]): ProjectModel => ({
  file,
  slicer: null,
  printerModel: null,
  printProfile: null,
  nozzleDiameter: null,
  sliced: plates.some((p) => p.sliced),
  multicolor: false,
  designTitle: null,
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
      expect((await scanFolder(dir)).mainFile).toBe("foo.3mf");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("scanFolder file limit", () => {
  it("lists at most maxFiles files, in name order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scan-"));
    try {
      for (const n of ["a", "b", "c"]) await writeFile(join(dir, `${n}.png`), "x");
      expect((await scanFolder(dir, null, 2)).files.map((f) => f.path)).toEqual(["a.png", "b.png"]);
      expect((await scanFolder(dir)).files).toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("for a device root", () => {
  it("finds project folders, digests their file list and keeps each doc's text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scan-"));
    try {
      await mkdir(join(dir, "A", "parts"), { recursive: true });
      await mkdir(join(dir, "B"));
      await writeFile(join(dir, "A", "a.stl"), "x");
      await writeFile(join(dir, "A", "notes.md"), "Hi");
      await writeFile(join(dir, "B", "b.txt"), "x");
      expect(await discoverFolders(dir, 1)).toEqual(["A", "B"]);

      const a = join(dir, "A");
      const before = await folderDigest(a, 100, null);
      expect(await folderDigest(a, 100, null)).toBe(before);
      await writeFile(join(dir, "A", "a.stl.tmp"), "half"); // a slicer's save in progress
      expect(await folderDigest(a, 100, null)).toBe(before);
      await writeFile(join(dir, "A", "a.stl"), "xy");
      expect(await folderDigest(a, 100, null)).not.toBe(before);

      const scan = await scanFolder(a);
      expect(scan.texts).toEqual({ "notes.md": "Hi" });
      expect(descriptionOf(scan.texts, "notes.md")).toBe("Hi");
      expect(descriptionOf(scan.texts, "other.md")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
