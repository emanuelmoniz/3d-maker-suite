import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { slicerPresetLibrary, systemPresets } from "./index.ts";
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

describe("catalogFingerprint", () => {
  const fingerprint = () => slicerPresetLibrary("s", () => []).catalogFingerprint?.(dir);

  it("is the sorted vendor versions: a recopy changes nothing, a new version does", async () => {
    put("system/Voron.json", { name: "Voron", version: "1.0" });
    put("system/BBL.json", { name: "Bambulab", version: "02.09.00.74" });
    put("system/BBL/machine/A1.json", { name: "A1", version: "9" });
    const before = await fingerprint();
    expect(before).toBe("BBL=02.09.00.74;Voron=1.0");

    put("system/BBL.json", { name: "Bambulab", version: "02.09.00.74" });
    expect(await fingerprint()).toBe(before);

    put("system/BBL.json", { name: "Bambulab", version: "02.09.00.75" });
    expect(await fingerprint()).not.toBe(before);
  });

  it("is null with no vendor index (Orca 2.5+) or one that can't be read yet", async () => {
    expect(await fingerprint()).toBeNull();
    writeFileSync(put("system/orca.opc", {}), "binary");
    expect(await fingerprint()).toBeNull();

    put("system/BBL.json", { version: "1" });
    writeFileSync(join(dir, "system", "Voron.json"), '{"version":');
    expect(await fingerprint()).toBeNull();
  });
});

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

describe("settings", () => {
  const settings = (
    kind: "filament" | "machine" | "process",
    scope: "system" | "user",
    name: string,
  ) => slicerPresetLibrary("s", () => []).settings?.(dir, kind, { scope, name });

  beforeEach(() => {
    put("system/BBL/filament/fdm_filament_common.json", {
      name: "fdm_filament_common",
      filament_type: ["PLA"],
      nozzle_temperature: ["200"],
      cool_plate_temp: ["35"],
    });
    put("system/BBL/filament/Bambu PLA Basic @BBL X1C.json", {
      name: "Bambu PLA Basic @BBL X1C",
      inherits: "fdm_filament_common",
      instantiation: "true",
      nozzle_temperature: ["220"],
    });
  });

  it("lists a system filament by its base name, each value with the preset it comes from", async () => {
    const got = await settings("filament", "system", "Bambu PLA Basic");
    expect(got?.parents).toEqual(["fdm_filament_common"]);
    expect(got?.missing).toBeNull();
    expect(got?.settings).toEqual([
      { key: "cool_plate_temp", value: "35", from: "fdm_filament_common" },
      { key: "filament_type", value: "PLA", from: "fdm_filament_common" },
      { key: "instantiation", value: "true", from: null },
      { key: "name", value: "Bambu PLA Basic @BBL X1C", from: null },
      { key: "nozzle_temperature", value: "220", from: null },
    ]);
  });

  it("shows a user preset's own values over its parent's, and says when the parent is gone", async () => {
    put("user/default/filament/Mine.json", {
      name: "Mine",
      inherits: "fdm_filament_common",
      cool_plate_temp: ["40"],
    });
    put("user/default/filament/Orphan.json", { name: "Orphan", inherits: "Nowhere", x: ["1"] });

    const mine = await settings("filament", "user", "Mine");
    expect(mine?.settings.find((s) => s.key === "cool_plate_temp")).toEqual({
      key: "cool_plate_temp",
      value: "40",
      from: null,
    });
    expect(mine?.settings.find((s) => s.key === "nozzle_temperature")?.from).toBe(
      "fdm_filament_common",
    );

    const orphan = await settings("filament", "user", "Orphan");
    expect(orphan).toMatchObject({ parents: [], missing: "Nowhere" });
    expect(orphan?.settings.map((s) => s.key)).toEqual(["name", "x"]);
  });

  it("is undefined for a preset the folder doesn't have", async () => {
    expect(await settings("filament", "system", "Nope")).toBeUndefined();
    expect(await settings("machine", "user", "Nope")).toBeUndefined();
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
