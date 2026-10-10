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

describe("bambu studio catalog", () => {
  beforeEach(() => {
    put("system/BBL.json", {
      name: "Bambulab",
      machine_model_list: [
        { name: "Bambu Lab A1", sub_path: "machine/Bambu Lab A1.json" },
        { name: "Bambu Lab P1S" },
      ],
    });
    put("system/BBL/Bambu Lab A1_cover.png", "png");
    put("system/BBL/machine/fdm_machine_common.json", {
      name: "fdm_machine_common",
      type: "machine",
      nozzle_diameter: ["0.4"],
    });
    put("system/BBL/machine/Bambu Lab A1.json", { name: "Bambu Lab A1", type: "machine_model" });
    for (const n of ["0.2", "0.4"])
      put(`system/BBL/machine/Bambu Lab A1 ${n} nozzle.json`, {
        name: `Bambu Lab A1 ${n} nozzle`,
        type: "machine",
        inherits: "fdm_machine_common",
        instantiation: "true",
        printer_model: "Bambu Lab A1",
        nozzle_diameter: [n],
      });
    put("system/BBL/machine/Bambu Lab A1 0.4 nozzle template machine_end_gcode.json", {
      name: "tpl",
      type: "machine",
      instantiation: "false",
    });
    put("user/123/machine/My A1.json", { name: "My A1", inherits: "Bambu Lab A1 0.4 nozzle" });
    put("user/123/machine/Mystery.json", {
      name: "Mystery",
      printer_model: "Nope",
      nozzle_diameter: ["0.4"],
    });
  });

  it("reads models with thumbnails and the pickable machine presets", async () => {
    const { models, machines } = (await bambuStudioLibrary().readCatalog?.(dir)) ?? {
      models: [],
      machines: [],
    };
    expect(models).toEqual([
      {
        brand: "Bambu Lab",
        model: "Bambu Lab A1",
        image: join(dir, "system/BBL/Bambu Lab A1_cover.png"),
      },
      { brand: "Bambu Lab", model: "Bambu Lab P1S", image: null },
    ]);
    expect(machines.map((m) => [m.presetId, m.model, m.nozzleDiameterMm])).toEqual([
      ["user/My A1", "Bambu Lab A1", 0.4], // inherits model and nozzle from its system parent
      ["system/Bambu Lab A1 0.2 nozzle", "Bambu Lab A1", 0.2],
      ["system/Bambu Lab A1 0.4 nozzle", "Bambu Lab A1", 0.4],
    ]);
  });
});
