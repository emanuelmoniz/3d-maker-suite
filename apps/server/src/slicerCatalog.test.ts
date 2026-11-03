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
import { eq } from "drizzle-orm";
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

describe("deleted catalog rows", () => {
  const { brands, deletedSources, filamentBrands, filamentMaterials, filamentProfiles } = schema;
  const { machineProfiles, printerModels, printProfiles } = schema;
  const types = [
    ["brands", "/api/brands", brands],
    ["printerModels", "/api/printer-models", printerModels],
    ["machineProfiles", "/api/machine-profiles", machineProfiles],
    ["printProfiles", "/api/print-profiles", printProfiles],
    ["filamentBrands", "/api/filament-brands", filamentBrands],
    ["filamentMaterials", "/api/filament-materials", filamentMaterials],
    ["filamentProfiles", "/api/filament/profiles", filamentProfiles],
  ] as const;

  it.each(types)(
    "%s: a run doesn't bring it back; importing it by hand does",
    async (type, url, table) => {
      const t = table as typeof brands;
      if (type === "filamentProfiles") {
        await run("filamentBrands");
        await run("filamentMaterials");
      }
      await run(type);
      const count = () => db.select().from(t).all().length;
      const before = count();
      const row = db.select().from(t).get();
      if (!row) throw new Error("nothing imported");
      const res = await app.inject({ method: "DELETE", url: `${url}/${row.id}` });
      expect(res.statusCode, res.body).toBe(204);

      // Not re-added, and nothing waits for a person.
      expect(await run(type)).toMatchObject({ created: 0, updated: 0, pending: 0 });
      expect(count()).toBe(before - 1);

      // The review offers it as a skip, marked.
      const preview = await open(type);
      const offered = preview.rows.find((r) => r.deleted);
      expect(offered).toMatchObject({ action: "skip", status: "new" });
      expect(offered?.auto).toBeUndefined();
      if (!offered) throw new Error("not offered");

      const done = await review.confirm(preview, [offered], { action: "create" });
      expect(done.statusCode, done.body).toBe(200);
      expect(count()).toBe(before);
      expect(db.select().from(deletedSources).all()).toEqual([]);
      expect((await open(type)).rows.some((r) => r.deleted)).toBe(false);
    },
  );

  it("a model a run needs is still created, and that clears its brand's mark", async () => {
    await run("brands");
    const brand = db.select().from(brands).get();
    await app.inject({ method: "DELETE", url: `/api/brands/${brand?.id}` });
    expect(db.select().from(deletedSources).all()).toMatchObject([
      { entity: "brands", source: "acme" },
    ]);

    expect((await run("printerModels")).created).toBe(1);

    expect(db.select().from(brands).all()).toMatchObject([{ name: "Acme" }]);
    expect(db.select().from(deletedSources).all()).toEqual([]);
  });

  it("a mark only counts when nothing you have is the row", async () => {
    await run("brands");
    const brand = db.select().from(brands).get();
    await app.inject({ method: "DELETE", url: `/api/brands/${brand?.id}` });
    await app.inject({ method: "POST", url: "/api/brands", payload: { name: "Acme" } });
    expect((await open("brands")).rows.some((r) => r.deleted)).toBe(false);
  });
});

describe("archived catalog rows", () => {
  const { brands, printerModels, machineProfiles, printProfiles, filamentBrands } = schema;
  const { filamentMaterials, filamentProfiles } = schema;
  const types = [
    ["brands", "/api/brands", brands],
    ["printerModels", "/api/printer-models", printerModels],
    ["machineProfiles", "/api/machine-profiles", machineProfiles],
    ["printProfiles", "/api/print-profiles", printProfiles],
    ["filamentBrands", "/api/filament-brands", filamentBrands],
    ["filamentMaterials", "/api/filament-materials", filamentMaterials],
  ] as const;

  it.each(types)(
    "%s: a run leaves it alone; a confirmed update restores it",
    async (type, url, table) => {
      const t = table as typeof brands;
      await run(type);
      const count = () => db.select().from(t).all().length;
      const before = count();
      const row = db.select().from(t).get();
      if (!row) throw new Error("nothing imported");
      await app.inject({ method: "PATCH", url: `${url}/${row.id}`, payload: { archived: true } });

      // Not re-added, not touched, and nothing waits for a person.
      expect(await run(type)).toMatchObject({ created: 0, updated: 0, pending: 0 });
      expect(count()).toBe(before);
      const stamp = db.select().from(t).where(eq(t.id, row.id)).get()?.archivedAt;
      expect(stamp).toBeTruthy();

      // The review offers it as a skip against the archived row.
      const preview = await open(type);
      const offered = preview.rows.find((r) => r.targetId === row.id);
      expect(offered).toMatchObject({ action: "skip" });
      expect(preview.targets.find((x) => x.id === row.id)?.archived).toBe(true);

      if (!offered) throw new Error("not offered");
      const res = await review.confirm(preview, [offered], { action: "update" });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ created: 0, updated: 1 });
      expect(db.select().from(t).where(eq(t.id, row.id)).get()?.archivedAt).toBeNull();
      expect(count()).toBe(before);
    },
  );

  it("restoring a preset a print uses, unchanged, makes no new version", async () => {
    await run("machineProfiles");
    const row = db.select().from(machineProfiles).get();
    if (!row) throw new Error("nothing imported");
    const printer = db
      .insert(schema.printers)
      .values({ name: "P", number: 1, modelId: row.printerModelId })
      .returning()
      .get();
    db.insert(schema.prints)
      .values({
        printerId: printer.id,
        machineProfileId: row.id,
        title: "T",
        startedAt: new Date().toISOString(),
        outcome: "success",
      })
      .run();
    await app.inject({
      method: "PATCH",
      url: `/api/machine-profiles/${row.id}`,
      payload: { archived: true },
    });

    const preview = await open("machineProfiles");
    await review.confirm(preview, preview.rows, { action: "update" });

    expect(db.select().from(machineProfiles).all()).toMatchObject([
      { id: row.id, archivedAt: null },
    ]);
  });

  it.each([
    ["machineProfiles", machineProfiles],
    ["printProfiles", printProfiles],
    ["filamentProfiles", filamentProfiles],
  ] as const)(
    "%s: of several archived versions the newest is the one offered",
    async (type, table) => {
      await run("filamentBrands");
      await run("filamentMaterials");
      await run(type);
      const t = table as typeof machineProfiles;
      const newest = db.select().from(t).get();
      if (!newest?.sourcePreset) throw new Error("nothing imported");
      const { id: _id, ...fields } = newest;
      const stamp = "2026-01-01T00:00:00.000Z";
      // Inserted last and archived last, but the oldest: order must not decide.
      db.update(t).set({ archivedAt: stamp }).where(eq(t.id, newest.id)).run();
      db.insert(t)
        .values({
          ...fields,
          createdAt: "2020-01-01T00:00:00.000Z",
          archivedAt: "2026-06-01T00:00:00.000Z",
        })
        .run();

      const preview = await open(type);
      const offered = preview.rows.find((r) => r.values.name === newest.name);
      expect(offered?.targetId).toBe(newest.id);
    },
  );

  it("an archived brand isn't restored by a model that needs it, and templates don't offer it", async () => {
    await run("brands");
    const brand = db.select().from(brands).get();
    await app.inject({
      method: "PATCH",
      url: `/api/brands/${brand?.id}`,
      payload: { archived: true },
    });

    expect((await run("printerModels")).created).toBe(1);

    expect(db.select().from(brands).all()).toMatchObject([{ id: brand?.id }]);
    expect(db.select().from(brands).get()?.archivedAt).toBeTruthy();
    expect(db.select().from(printerModels).get()?.brandId).toBe(brand?.id);
    expect((await open("printerModels")).refNames.brands).toEqual([]);
  });

  it("a file naming an archived model adds nothing and doesn't say it did", async () => {
    await run("printerModels");
    const model = db.select().from(printerModels).get();
    await app.inject({
      method: "PATCH",
      url: `/api/printer-models/${model?.id}`,
      payload: { archived: true },
    });
    const preview = (
      await app.inject({
        method: "POST",
        url: "/api/import/printerModels/preview",
        headers: { "content-type": "text/csv" },
        payload: "Brand,Model\nAcme,Acme X\n",
      })
    ).json() as ImportPreview;

    const res = await review.confirm(preview);

    expect(res.json()).toMatchObject({ created: 0 });
    expect(db.select().from(printerModels).all()).toHaveLength(1);
    expect(db.select().from(printerModels).get()?.archivedAt).toBeTruthy();
  });
});

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

  it("Only what I already have: models of your brands arrive, other brands' never", async () => {
    state.catalog.models.push({ brand: "Prusa", model: "MK4", image: null });
    // You import only Acme.
    const brands = await open("brands");
    const acme = brands.rows.filter((r) => r.values.name === "Acme");
    expect((await review.confirm(brands, acme)).json()).toMatchObject({ created: 1 });
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${id}`,
      payload: {
        policies: ["brands", "printerModels"].map((type) => ({ type, scope: "imported" })),
      },
    });
    expect(await run("brands")).toMatchObject({ created: 0, pending: 0 });
    expect(await run("printerModels")).toMatchObject({ created: 1, pending: 0 });
    // A new model of your brand still arrives.
    state.catalog.models.push({ brand: "Acme", model: "Acme Y", image: null });
    expect(await run("printerModels")).toMatchObject({ created: 1, pending: 0 });
    expect(
      db
        .select({ model: schema.printerModels.model })
        .from(schema.printerModels)
        .all()
        .map((m) => m.model)
        .sort(),
    ).toEqual(["Acme X", "Acme Y"]);
    expect(db.select().from(schema.brands).all()).toHaveLength(1);
  });

  it("Only what I already have: presets you imported stay up to date, new ones never arrive", async () => {
    for (const type of ["brands", "printerModels", "filamentBrands", "filamentMaterials"])
      await run(type);
    // You import one filament preset of the brand; the slicer has another of it.
    state.presets = [preset(), preset({ presetId: "user/B", name: "B" })];
    const profiles = await open("filamentProfiles");
    const a = profiles.rows.filter((r) => r.values.name === "A");
    expect((await review.confirm(profiles, a)).json()).toMatchObject({ created: 1 });
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${id}`,
      payload: {
        policies: ["filamentProfiles", "machineProfiles"].map((type) => ({
          type,
          scope: "imported",
        })),
      },
    });
    // "B" has a brand you have, yet it is neither added nor left for review.
    expect(await run("filamentProfiles")).toMatchObject({ created: 0, pending: 0 });
    expect(await run("machineProfiles")).toMatchObject({ created: 0, pending: 0 });
    // The one you have follows the slicer.
    state.presets = [preset({ pricePerKg: 2500 }), preset({ presetId: "user/B", name: "B" })];
    expect(await run("filamentProfiles")).toMatchObject({ created: 0, updated: 1, pending: 0 });
    expect(
      db
        .select({ name: schema.filamentProfiles.name })
        .from(schema.filamentProfiles)
        .all()
        .map((p) => p.name),
    ).toEqual(["A"]);
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
