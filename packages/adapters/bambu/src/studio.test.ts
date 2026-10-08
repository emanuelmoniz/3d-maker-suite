import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bambuStudioLibrary, studioDefaultDirs } from "./studio.ts";

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
        colorHex: "#ff8800",
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
    expect(system.map((i) => [i.presetId, i.brand, i.material, i.colorHex])).toEqual([
      ["system/Acme PLA", "Acme", "PLA", "#808080"],
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
