import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import type {
  FilamentLibrary,
  ImportPreview,
  IntegrationAdapter,
  LibraryPreset,
  SlicerCatalog,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { reviewer } from "./testReview.ts";

// A slicer with a mutable catalog and presets, to change "in the slicer" between imports.
const state: { catalog: SlicerCatalog; presets: LibraryPreset[] } = {
  catalog: null as never,
  presets: [],
};
const machine = (nozzle = 0.4, name = "Acme X 0.4") => ({
  presetId: "system/Acme X 0.4",
  scope: "system" as const,
  brand: "Acme",
  model: "Acme X",
  name,
  nozzleDiameterMm: nozzle,
});
const preset = (extra = {}): LibraryPreset => ({
  presetId: "user/A",
  scope: "user",
  brand: "Acme",
  material: "PLA",
  name: "A",
  diameterMm: 1.75,
  densityGcm3: 1.24,
  pricePerKg: 2000,
  nozzleTempC: 220,
  bedTempC: 55,
  ...extra,
});

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dataDir: string;
let id: string;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "catalog-"));
  const cover = join(dataDir, "cover.png");
  writeFileSync(cover, "png");
  state.catalog = {
    models: [{ brand: "Acme", model: "Acme X", image: cover }],
    machines: [machine()],
    processes: [
      {
        presetId: "system/0.20mm Standard @Acme X",
        scope: "system",
        name: "0.20mm Standard @Acme X",
        brand: "Acme",
        model: "Acme X",
        nozzleDiameterMm: 0.4,
        layerHeightMm: 0.2,
      },
      {
        presetId: "user/Loose",
        scope: "user",
        name: "Loose",
        brand: null,
        model: null,
        nozzleDiameterMm: null,
        layerHeightMm: 0.28,
      },
    ],
  };
  state.presets = [preset()];
  const library: FilamentLibrary = {
    id: "fake",
    defaultDirs: () => [dataDir],
    read: async () => state.presets,
    readCatalog: async () => state.catalog,
  };
  const slicer = {
    ...mockAdapter(fixture()),
    id: "slicer",
    kind: "local",
    capabilities: [
      "brands",
      "printerModels",
      "machineProfiles",
      "printProfiles",
      "filamentBrands",
      "filamentMaterials",
      "filamentProfiles",
    ],
    library,
  };
  db = openDb(":memory:");
  app = await buildApp(db, false, dataDir, { adapters: [slicer as IntegrationAdapter] });
  id = (
    await app.inject({
      method: "POST",
      url: "/api/integrations",
      payload: { adapterId: "slicer", secrets: { token: "t" } },
    })
  ).json().id;
});

const review = reviewer(() => app);
const open = async (type: string) =>
  (await review.open(`/api/import/integration/${id}/${type}`)).json() as ImportPreview;
const run = async (type: string) =>
  (
    await app.inject({ method: "POST", url: `/api/integrations/${id}/sync`, payload: { type } })
  ).json();

describe("slicer catalog import", () => {
  it("reviews, imports the confirmed rows, and a re-import adds nothing", async () => {
    const brands = await open("brands");
    expect(brands.rows.map((r) => `${r.values.name}:${r.status}`)).toEqual(["Acme:new"]);
    expect((await review.confirm(brands)).json()).toMatchObject({ created: 1, updated: 0 });
    expect(db.select().from(schema.importRuns).all()).toMatchObject([
      { source: "integration", type: "brands", created: 1 },
    ]);

    // Models and machine profiles find the brand, and the thumbnail is copied once.
    expect((await run("printerModels")).created).toBe(1);
    expect((await run("machineProfiles")).created).toBe(1);
    const model = db.select().from(schema.printerModels).get();
    expect(model?.imagePath).toBe(`models/${model?.id}.png`);
    expect(existsSync(join(dataDir, model?.imagePath ?? ""))).toBe(true);
    expect((await run("filamentBrands")).created).toBe(1); // "Acme"
    expect((await run("filamentMaterials")).created).toBe(1); // "PLA"

    for (const type of [
      "brands",
      "printerModels",
      "machineProfiles",
      "filamentBrands",
      "filamentMaterials",
    ])
      expect(await run(type)).toMatchObject({ created: 0, status: "ok" });
    expect(db.select().from(schema.brands).all()).toHaveLength(1);
    expect(db.select().from(schema.printerModels).all()).toHaveLength(1);
    expect(db.select().from(schema.machineProfiles).all()).toHaveLength(1);
    expect(db.select().from(schema.filamentBrands).all()).toHaveLength(1);
    expect(db.select().from(schema.filamentMaterials).all()).toHaveLength(1);
  });

  it("a changed unused machine preset updates in place; a used one is archived and re-added", async () => {
    await run("machineProfiles");
    const first = db.select().from(schema.machineProfiles).get();
    expect(first?.sourcePreset).toBe("fake:system/Acme X 0.4");

    state.catalog.machines = [machine(0.6, "Acme X 0.6")];
    expect((await open("machineProfiles")).rows[0]).toMatchObject({
      status: "changed",
      auto: "apply",
    });
    await run("machineProfiles");
    expect(db.select().from(schema.machineProfiles).all()).toMatchObject([
      { id: first?.id, name: "Acme X 0.6", nozzleDiameterMm: 0.6, archivedAt: null },
    ]);

    const printer = db
      .insert(schema.printers)
      .values({ number: 1, name: "P", modelId: first?.printerModelId })
      .returning()
      .get();
    db.insert(schema.prints)
      .values({
        printerId: printer.id,
        machineProfileId: first?.id,
        title: "t",
        startedAt: "2026-01-01T00:00:00.000Z",
        outcome: "success",
      })
      .run();
    state.catalog.machines = [machine(0.8, "Acme X 0.8")];
    await run("machineProfiles");
    const rows = db.select().from(schema.machineProfiles).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first?.id)).toMatchObject({ name: "Acme X 0.6" });
    expect(rows.find((r) => r.id === first?.id)?.archivedAt).toBeTruthy();
    expect(rows.find((r) => r.id !== first?.id)).toMatchObject({
      name: "Acme X 0.8",
      archivedAt: null,
      sourcePreset: "fake:system/Acme X 0.4",
    });

    // The list hides the old version; the print still resolves it.
    const list = (await app.inject("/api/machine-profiles")).json();
    expect(list.items.map((m: { name: string }) => m.name)).toEqual(["Acme X 0.8"]);
    expect((await app.inject(`/api/machine-profiles/${first?.id}`)).json().archivedAt).toBeTruthy();
  });

  it("a sync imports print profiles, built-in or not, with or without a known printer, and updates them in place", async () => {
    const preview = await open("printProfiles");
    expect(preview.rows.map((r) => [r.values.name, r.status])).toEqual([
      ["0.20mm Standard @Acme X", "new"],
      ["Loose", "new"],
    ]);
    expect(await run("printProfiles")).toMatchObject({ created: 2, skipped: 0 });
    const rows = db.select().from(schema.printProfiles).all();
    const model = db.select().from(schema.printerModels).get();
    expect(rows).toMatchObject([
      { name: "0.20mm Standard @Acme X", printerModelId: model?.id, layerHeightMm: 0.2 },
      { name: "Loose", printerModelId: null, sourcePreset: "fake:user/Loose" },
    ]);

    state.catalog.processes = state.catalog.processes
      .filter((p) => p.name === "Loose")
      .map((p) => ({ ...p, layerHeightMm: 0.32 }));
    await run("printProfiles");
    expect(db.select().from(schema.printProfiles).all()).toHaveLength(2);
    const loose = (await app.inject("/api/print-profiles?name=Loose")).json();
    expect(loose.items).toMatchObject([{ id: rows[1]?.id, layerHeightMm: 0.32 }]);
  });

  it("a changed filament preset follows the same rule, keeping a price the preset doesn't give", async () => {
    await run("filamentBrands");
    await run("filamentMaterials");
    // Confirms what the review suggests for the one preset.
    const imp = async () => review.confirm(await open("filamentProfiles"));
    await imp();
    const first = db.select().from(schema.filamentProfiles).get();
    db.update(schema.filamentProfiles).set({ pricePerKg: 3500 }).run(); // entered by hand

    state.presets = [preset({ nozzleTempC: 230, pricePerKg: null })];
    const status = async () => (await open("filamentProfiles")).rows[0]?.status;
    expect(await status()).toBe("changed");
    expect((await imp()).json()).toMatchObject({ created: 0, updated: 1 });
    expect(db.select().from(schema.filamentProfiles).all()).toMatchObject([
      { id: first?.id, nozzleTempC: 230, pricePerKg: 3500, archivedAt: null },
    ]);
    expect(await status()).toBe("identical");

    // A spool uses it: the next change archives it and adds a new version.
    db.insert(schema.spools)
      .values({ profileId: first?.id ?? "", initialGrams: 1000, remainingGrams: 1000 })
      .run();
    state.presets = [preset({ nozzleTempC: 240, pricePerKg: null })];
    await imp();
    const rows = db.select().from(schema.filamentProfiles).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first?.id)).toMatchObject({ nozzleTempC: 230 });
    expect(rows.find((r) => r.id === first?.id)?.archivedAt).toBeTruthy();
    expect(rows.find((r) => r.id !== first?.id)).toMatchObject({
      nozzleTempC: 240,
      pricePerKg: 3500,
      archivedAt: null,
    });
    const active = (await app.inject("/api/filament/profiles")).json();
    expect(active.total).toBe(1);
  });
});
