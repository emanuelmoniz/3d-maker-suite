import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { systemPresets } from "./index.ts";
import { presetsOf } from "./slice.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "presets-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, json: object) => {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(json));
  return file;
};

describe("flatten", () => {
  it("fills in parents of the same vendor and included templates, for the slicer CLI", async () => {
    // Every vendor ships a base with the same name; "Anker" sorts first.
    put("system/Anker/machine/fdm_machine_common.json", {
      name: "fdm_machine_common",
      change_filament_gcode: "anker",
      bed: "anker",
    });
    put("system/BBL/machine/fdm_machine_common.json", {
      name: "fdm_machine_common",
      change_filament_gcode: "generic",
      bed: "bbl",
    });
    put("system/BBL/machine/A1 template change_filament_gcode.json", {
      name: "A1 template change_filament_gcode",
      instantiation: "false",
      change_filament_gcode: "a1 purge",
    });
    const a1 = put("system/BBL/machine/A1.json", {
      name: "A1",
      inherits: "fdm_machine_common",
      instantiation: "true",
      include: ["A1 template change_filament_gcode"],
      nozzle: "0.4",
    });

    const machines = await systemPresets(dir, "machine");
    const flat = await machines.flatten((await machines.load(a1)) ?? {}, a1);
    expect(flat).toEqual({
      name: "A1",
      instantiation: "true",
      nozzle: "0.4",
      bed: "bbl",
      change_filament_gcode: "a1 purge",
    });
    expect((await machines.resolver((await machines.load(a1)) ?? {}, a1))("bed")).toBe("bbl");
  });
});

describe("presetsOf", () => {
  it("reads the 3MF's presets and the settings it changed from them", async () => {
    const own = await presetsOf(join(import.meta.dirname, "../../3mf/fixtures/multi_color.3mf"));
    expect(own.machine).toBe("Bambu Lab A1 0.4 nozzle");
    expect(own.filaments).toHaveLength(4);
    expect(own.processEdits).toEqual({
      interface_shells: "1",
      skeleton_infill_density: "8%",
      skin_infill_density: "8%",
      sparse_infill_density: "8%",
      top_one_wall_type: "not apply",
    });
    expect(own.machineEdits).toEqual({});
    expect(own.filamentEdits(0)).toEqual({});
  });
});
