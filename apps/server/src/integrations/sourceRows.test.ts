import type { FilamentLibrary, LibraryPreset } from "@3d-maker-suite/core";
import { describe, expect, it } from "vitest";
import { type LibraryType, libraryRows } from "./sourceRows.ts";

const preset = (scope: "system" | "user", name: string): LibraryPreset => ({
  presetId: `${scope}/${name}`,
  scope,
  brand: scope === "system" ? "Sys" : "Mine",
  material: "PLA",
  name,
  diameterMm: 1.75,
  densityGcm3: 1.24,
  nozzleTempC: 220,
  bedTempC: 55,
});
const machine = (scope: "system" | "user", brand: string) => ({
  presetId: `${scope}/M`,
  scope,
  brand,
  model: "X",
  name: `${scope} M`,
  nozzleDiameterMm: 0.4,
  defaultPrintPreset: scope === "system" ? "system/P" : null,
});
const process = (scope: "system" | "user") => ({
  presetId: `${scope}/P`,
  scope,
  name: `${scope} P`,
  brand: null,
  model: null,
  nozzleDiameterMm: null,
  layerHeightMm: 0.2,
  machines: scope === "system" ? ["system/M", "user/M"] : [],
});

const lib: FilamentLibrary = {
  id: "fake",
  defaultDirs: () => [],
  // Like the real readers: system presets only when asked for.
  read: async (_dir, o) => [
    preset("user", "U"),
    ...(o?.includeSystem ? [preset("system", "S")] : []),
  ],
  readCatalog: async () => ({
    models: [{ brand: "Sys", model: "X", image: null }],
    machines: [machine("system", "Sys"), machine("user", "Mine")],
    processes: [process("system"), process("user")],
  }),
};

const sources = async (type: LibraryType, scope?: "system" | "user") =>
  (await libraryRows(lib, "", type, { dataDir: "", scope })).map((r) => r.source);
const raws = async (type: LibraryType, scope?: "system" | "user") =>
  (await libraryRows(lib, "", type, { dataDir: "", scope })).map((r) => r.raw.name ?? r.raw.model);

describe("libraryRows scope", () => {
  it.each([
    ["filamentProfiles", ["fake:user/U", "fake:system/S"]],
    ["machineProfiles", ["fake:system/M", "fake:user/M"]],
    ["printProfiles", ["fake:system/P", "fake:user/P"]],
  ] as const)("%s: both by default, then each alone", async (type, both) => {
    expect((await sources(type)).sort()).toEqual([...both].sort());
    expect(await sources(type, "system")).toEqual([both.find((s) => s.includes("system"))]);
    expect(await sources(type, "user")).toEqual([both.find((s) => s.includes("user"))]);
  });

  it("brands and models: vendor models are system", async () => {
    expect((await raws("brands")).sort()).toEqual(["Mine", "Sys"]);
    expect(await raws("brands", "system")).toEqual(["Sys"]);
    expect(await raws("brands", "user")).toEqual(["Mine"]);
    expect(await raws("printerModels")).toEqual(["X"]);
    expect(await raws("printerModels", "user")).toEqual([]);
  });

  it("keeps the presets a preset names by key, and shows their names", async () => {
    const [proc] = await libraryRows(lib, "", "printProfiles", { dataDir: "", scope: "system" });
    expect(proc?.raw).toMatchObject({
      printers: "M, M",
      machinePresets: ["fake:system/M", "fake:user/M"],
    });
    const [m] = await libraryRows(lib, "", "machineProfiles", { dataDir: "", scope: "system" });
    expect(m?.raw).toMatchObject({ defaultPrintProfile: "P", defaultPrintPreset: "fake:system/P" });
  });

  it("filament brands: the user's only", async () => {
    expect(await raws("filamentBrands", "user")).toEqual(["Mine"]);
    expect(await raws("filamentBrands", "system")).toEqual(["Sys"]);
  });
});
