import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bambuStudioLibrary, readStudioSpools, studioDefaultDirs } from "./studio.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "studio-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, json: unknown) => {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof json === "string" ? json : JSON.stringify(json));
};
const sys = "system/BBL/filament";

describe("bambu studio library", () => {
  beforeEach(() => {
    put(`${sys}/fdm_filament_common.json`, {
      name: "fdm_filament_common",
      filament_type: ["PLA"],
      filament_vendor: ["Generic"],
      filament_diameter: ["1.75"],
      filament_density: ["0"],
    });
    put(`${sys}/fdm_filament_pla.json`, {
      name: "fdm_filament_pla",
      inherits: "fdm_filament_common",
      filament_density: ["1.24"],
      filament_cost: ["20"],
      nozzle_temperature: ["220"],
      hot_plate_temp: ["55"],
    });
    put(`${sys}/Acme PLA @base.json`, {
      name: "Acme PLA @base",
      inherits: "fdm_filament_pla",
      instantiation: "false",
      filament_vendor: ["Acme"],
    });
    for (const printer of ["A1", "X1C"])
      put(`${sys}/Acme PLA @BBL ${printer}.json`, {
        name: `Acme PLA @BBL ${printer}`,
        inherits: "Acme PLA @base",
        instantiation: "true",
      });
    put("user/123/filament/base/My PETG.json", {
      name: "My PETG",
      inherits: "Acme PLA @BBL A1",
      filament_type: ["PETG"],
      default_filament_colour: ["#FF8800FF"],
      filament_cost: ["25.5"],
    });
    put("user/default/filament/My PETG.json", { name: "My PETG", filament_type: ["ABS"] });
    put("user/123/filament/broken.json", "{ nope");
    put("user/123/filament/My PETG.info", "sync_info = update");
  });

  const read = (includeSystem: boolean) => bambuStudioLibrary().read(dir, { includeSystem });

  it("resolves user presets through the inherits chain", async () => {
    const items = await read(false);
    expect(items).toEqual([
      {
        presetId: "user/My PETG",
        scope: "user",
        brand: "Acme",
        material: "PETG",
        name: "My PETG",
        diameterMm: 1.75,
        densityGcm3: 1.24,
        pricePerKg: 2550,
        nozzleTempC: 220,
        bedTempC: 55,
      },
    ]);
  });

  it("lists system presets once per filament when asked", async () => {
    const items = await read(true);
    const system = items.filter((i) => i.scope === "system");
    expect(system.map((i) => [i.presetId, i.brand, i.material])).toEqual([
      ["system/Acme PLA", "Acme", "PLA"],
    ]);
    expect(items).toHaveLength(2);
  });

  it("knows where each OS keeps its config", () => {
    expect(studioDefaultDirs("win32", { APPDATA: "C:A" }, "/h")[0]).toMatch(/BambuStudio$/);
    expect(studioDefaultDirs("darwin", {}, "/h")).toEqual([
      join("/h", "Library", "Application Support", "BambuStudio"),
    ]);
    expect(studioDefaultDirs("linux", {}, "/h")).toHaveLength(2);
  });
});

describe("bambu studio spools", () => {
  const spool = (id: string, extra = {}) => ({
    spool_id: id,
    brand: "Bambu Lab",
    material_type: "PLA",
    series: "PLA Matte",
    setting_id: "GFA01",
    color_code: "#042F56",
    diameter: 1.75,
    initial_weight: 1000.0,
    net_weight: 252.0,
    spool_weight: 0.0,
    status: "active",
    ...extra,
  });

  it("reads the inventory, with profile details from the matching system preset", async () => {
    put(`${sys}/Bambu PLA Matte @base.json`, {
      name: "Bambu PLA Matte @base",
      filament_id: "GFA01",
      filament_type: ["PLA"],
      filament_vendor: ["Bambu Lab"],
      filament_density: ["1.32"],
      nozzle_temperature: ["220"],
    });
    put("filament_inventory/spools.json", {
      spools: [
        spool("1"),
        spool("2", { setting_id: "GFX99", net_weight: 1000, spool_weight: 250 }),
        spool("3", { status: "deleted" }),
      ],
    });
    const [a, b, ...rest] = await readStudioSpools(dir);
    expect(rest).toEqual([]);
    expect(a).toEqual({
      spoolId: "1",
      colorHex: "#042f56",
      initialGrams: 1000,
      remainingGrams: 252,
      emptyWeightGrams: null,
      status: "in_use",
      // Named like the system preset, so it matches a profile imported from it.
      profile: { brand: "Bambu Lab", material: "PLA", name: "Bambu PLA Matte" },
    });
    // No preset with that id: named from the spool itself.
    expect(b).toMatchObject({
      status: "new",
      emptyWeightGrams: 250,
      profile: { brand: "Bambu Lab", material: "PLA", name: "PLA Matte" },
    });
  });

  it("has no spools without an inventory file", async () => {
    expect(await readStudioSpools(dir)).toEqual([]);
  });
});
