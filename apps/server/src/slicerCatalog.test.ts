import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  type FilamentLibrary,
  type ImportPreview,
  type IntegrationAdapter,
  type LibraryPreset,
  type SlicerCatalog,
  USER_PRESET_TYPES,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { loadKey } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { createSyncer } from "./integrations/sync.ts";
import { reviewer } from "./testReview.ts";

// A slicer with a mutable catalog and presets, to change "in the slicer" between imports.
const state: {
  catalog: SlicerCatalog;
  presets: LibraryPreset[];
  fingerprint: string | null;
  unreadable: boolean;
} = {
  catalog: null as never,
  presets: [],
  fingerprint: null,
  unreadable: false,
};
const machine = (nozzle = 0.4, name = "Acme X 0.4") => ({
  presetId: "system/Acme X 0.4",
  scope: "system" as const,
  brand: "Acme",
  model: "Acme X",
  name,
  nozzleDiameterMm: nozzle,
  defaultPrintPreset: null as string | null,
});
const preset = (extra = {}): LibraryPreset => ({
  presetId: "system/A",
  scope: "system",
  brand: "Acme",
  material: "PLA",
  name: "A",
  diameterMm: 1.75,
  densityGcm3: 1.24,
  nozzleTempC: 220,
  bedTempC: 55,
  ...extra,
});

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dataDir: string;
let id: string;
let slicer: IntegrationAdapter;

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
        machines: ["system/Acme X 0.4"],
      },
      {
        presetId: "system/Loose",
        scope: "system",
        name: "Loose",
        brand: null,
        model: null,
        nozzleDiameterMm: null,
        layerHeightMm: 0.28,
        machines: [],
      },
    ],
  };
  state.presets = [preset()];
  state.fingerprint = "Acme=1";
  state.unreadable = false;
  const library: FilamentLibrary = {
    id: "fake",
    defaultDirs: () => [dataDir],
    read: async () => state.presets,
    readCatalog: async () => {
      if (state.unreadable) throw new Error("unreadable");
      return state.catalog;
    },
    catalogFingerprint: async () => state.fingerprint,
  };
  slicer = {
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
      ...USER_PRESET_TYPES,
    ],
    library,
  } as IntegrationAdapter;
  db = openDb(":memory:");
  app = await buildApp(db, false, dataDir, { adapters: [slicer] });
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

describe("catalog change detection", () => {
  const { integrations, machineProfiles, syncPolicies, syncRuns } = schema;
  const syncer = (adapters = [slicer]) =>
    createSyncer(db, adapters, loadKey(dataDir), app.log, dataDir);
  const fingerprints = () =>
    db
      .select({ value: integrations.catalogFingerprint })
      .from(integrations)
      .all()
      .map((r) => r.value);
  const pendingOf = (type: string) =>
    db
      .select()
      .from(syncPolicies)
      .all()
      .find((p) => p.type === type)?.pending ?? 0;
  const runs = () => db.select().from(syncRuns).all().length;
  const alerts = async () => {
    await app.inject({ method: "POST", url: "/api/alerts/evaluate" });
    return (await app.inject("/api/alerts"))
      .json()
      .filter((a: { kind: string }) => a.kind === "sync_pending");
  };
  /** Machine profiles imported, the folder seen once, then one edited and one new in the slicer. */
  const vendorUpdate = async () => {
    await run("brands");
    await run("printerModels");
    await run("machineProfiles");
    await syncer().checkCatalogs();
    state.catalog.machines = [
      machine(0.6),
      { ...machine(0.2, "Acme X 0.2"), presetId: "system/Acme X 0.2" },
    ];
    state.fingerprint = "Acme=2";
  };

  it("the first check only records what it sees", async () => {
    await run("machineProfiles");
    state.catalog.machines = [machine(0.6)];
    const before = runs();
    await syncer().checkCatalogs();
    expect(fingerprints()).toEqual(["Acme=1"]);
    expect(pendingOf("machineProfiles")).toBe(0);
    expect(runs()).toBe(before);
    expect(await alerts()).toEqual([]);
  });

  it("an unchanged folder does nothing, whatever the presets say", async () => {
    await vendorUpdate();
    state.fingerprint = "Acme=1";
    const before = runs();
    await syncer().checkCatalogs();
    expect(pendingOf("machineProfiles")).toBe(0);
    expect(runs()).toBe(before);
    expect(await alerts()).toEqual([]);
  });

  it("no fingerprint (Orca 2.5+) does nothing", async () => {
    await vendorUpdate();
    state.fingerprint = null;
    await syncer().checkCatalogs();
    expect(fingerprints()).toEqual(["Acme=1"]);
    expect(pendingOf("machineProfiles")).toBe(0);
  });

  it("a change writes nothing and raises the alert; the review shows it and closes it", async () => {
    await vendorUpdate();
    const before = db.select().from(machineProfiles).all();
    await syncer().checkCatalogs();

    expect(db.select().from(machineProfiles).all()).toEqual(before);
    expect(fingerprints()).toEqual(["Acme=2"]);
    expect(pendingOf("machineProfiles")).toBe(2);
    // A manual type, the default: the alert is how you hear of it.
    const [alert, ...others] = await alerts();
    expect(others).toEqual([]);
    expect(alert).toMatchObject({
      task: `sync:${id}:machineProfiles`,
      context: { type: "machineProfiles", count: 2 },
      hasDetail: true,
    });

    // Checked again, nothing has moved: nothing is counted or logged twice.
    const logged = runs();
    await syncer().checkCatalogs();
    expect(runs()).toBe(logged);

    const preview = await open("machineProfiles");
    expect(preview.rows.map((r) => r.status).sort()).toEqual(["changed", "new"]);
    // Taking the edit and leaving the new one out still closes it.
    const edit = preview.rows.filter((r) => r.status === "changed");
    expect((await review.confirm(preview, edit)).statusCode).toBe(200);
    expect(pendingOf("machineProfiles")).toBe(0);
    expect(await alerts()).toEqual([]);
    expect(db.select().from(machineProfiles).all()).toHaveLength(before.length);
  });

  it("a type switched off raises nothing", async () => {
    await vendorUpdate();
    await syncer().checkCatalogs();
    db.update(syncPolicies).set({ mode: "off" }).run();
    expect(await alerts()).toEqual([]);
  });

  const setMode = (type: string, mode: "auto" | "manual") =>
    app.inject({
      method: "PATCH",
      url: `/api/integrations/${id}`,
      payload: { policies: [{ type, mode }] },
    });

  it("an Automatic type writes when the folder changes; a Manual one beside it only counts", async () => {
    await run("printProfiles");
    await vendorUpdate();
    await setMode("machineProfiles", "auto");
    state.catalog.processes = state.catalog.processes.map((p) => ({ ...p, layerHeightMm: 0.3 }));
    await syncer().checkCatalogs();

    expect(
      db
        .select()
        .from(machineProfiles)
        .all()
        .map((m) => m.nozzleDiameterMm)
        .sort(),
    ).toEqual([0.2, 0.6]);
    expect(pendingOf("machineProfiles")).toBe(0);
    expect(pendingOf("printProfiles")).toBe(2);
    expect(db.select().from(schema.printProfiles).get()?.layerHeightMm).not.toBe(0.3);
    expect(fingerprints()).toEqual(["Acme=2"]);

    const logged = runs();
    await syncer().checkCatalogs();
    expect(runs()).toBe(logged);
  });

  it("Automatic writes nothing at the first sight of a folder", async () => {
    await setMode("machineProfiles", "auto");
    await syncer().checkCatalogs();
    expect(db.select().from(machineProfiles).all()).toEqual([]);
    expect(fingerprints()).toEqual(["Acme=1"]);
  });

  it("the review of a system card shows no user presets, and a user card's no system ones", async () => {
    state.catalog.machines.push({
      ...machine(),
      presetId: "user/Mine",
      scope: "user",
      name: "Mine",
    });
    const names = async (type: string) => (await open(type)).rows.map((r) => r.values.name);
    expect(await names("machineProfiles")).toEqual(["Acme X 0.4"]);
    expect(await names("userMachineProfiles")).toEqual(["Mine"]);
  });

  it("a user preset you imported doesn't make a slicer update ask about its system presets", async () => {
    await syncer().checkCatalogs();
    state.catalog.machines = [
      { ...machine(), presetId: "user/Mine", scope: "user", name: "Mine" },
      machine(),
    ];
    mkdirSync(join(dataDir, "user", "default", "machine"), { recursive: true });
    writeFileSync(join(dataDir, "user", "default", "machine", "Mine.json"), "{}");
    await syncer().checkUserPresets();
    expect(db.select().from(machineProfiles).all()).toMatchObject([{ name: "Mine" }]);

    state.fingerprint = "Acme=2";
    await syncer().checkCatalogs();
    expect(pendingOf("machineProfiles")).toBe(0);
    expect(await alerts()).toEqual([]);
  });

  it("only counts types imported before, and only their system rows", async () => {
    await vendorUpdate();
    await syncer().checkCatalogs();
    // Never imported: nothing waits, though the slicer has rows for it.
    expect(pendingOf("printProfiles")).toBe(0);

    await run("printProfiles");
    state.catalog.processes.push({
      presetId: "user/New",
      scope: "user",
      name: "New",
      brand: null,
      model: null,
      nozzleDiameterMm: null,
      layerHeightMm: 0.28,
      machines: [],
    });
    state.fingerprint = "Acme=3";
    await syncer().checkCatalogs();
    expect(pendingOf("printProfiles")).toBe(0);
  });

  it("the scheduler leaves a slicer's catalog types alone", async () => {
    db.insert(syncPolicies)
      .values({ integrationId: id, type: "machineProfiles", mode: "auto", frequency: "1h" })
      .run();
    await syncer().runAll();
    expect(runs()).toBe(0);
    expect(db.select().from(machineProfiles).all()).toEqual([]);
  });

  it("a library's catalog belongs to its oldest row with a readable folder", async () => {
    const other = { ...slicer, id: "slicer-2" };
    const later = new Date(Date.now() + 60_000).toISOString();
    const { id: second } = db
      .insert(integrations)
      .values({ adapterId: other.id, createdAt: later })
      .returning()
      .get();
    const of = (rowId: string) =>
      db.select().from(integrations).where(eq(integrations.id, rowId)).get()?.catalogFingerprint;

    await syncer([slicer, other]).checkCatalogs();
    expect([of(id), of(second)]).toEqual(["Acme=1", null]);

    db.update(integrations).set({ enabled: false }).where(eq(integrations.id, id)).run();
    await syncer([slicer, other]).checkCatalogs();
    expect(of(second)).toBe("Acme=1");
  });

  it("a user preset's count is its own: its run leaves what a catalog change left waiting", async () => {
    await vendorUpdate();
    await syncer().checkCatalogs();
    expect(pendingOf("machineProfiles")).toBe(2);

    state.catalog.machines.push({
      ...machine(),
      presetId: "user/Mine",
      scope: "user",
      name: "Mine",
    });
    mkdirSync(join(dataDir, "user", "default", "machine"), { recursive: true });
    writeFileSync(join(dataDir, "user", "default", "machine", "Mine.json"), "{}");
    await syncer().checkUserPresets();

    expect(
      db
        .select()
        .from(machineProfiles)
        .all()
        .map((m) => m.name),
    ).toContain("Mine");
    expect(pendingOf("machineProfiles")).toBe(2);
    expect(pendingOf("userMachineProfiles")).toBe(0);
    expect(await alerts()).toHaveLength(1);
  });

  it("a read that fails keeps the old fingerprint, so the next check tries again", async () => {
    await vendorUpdate();
    state.unreadable = true;
    await syncer().checkCatalogs();
    expect(fingerprints()).toEqual(["Acme=1"]);
    expect(pendingOf("machineProfiles")).toBe(0);

    state.unreadable = false;
    await syncer().checkCatalogs();
    expect(fingerprints()).toEqual(["Acme=2"]);
    expect(pendingOf("machineProfiles")).toBe(2);
  });
});

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

  it("a row made by hand is linked by name: its name is locked, a file only fills empty fields", async () => {
    const send = (method: "POST" | "PATCH", url: string, payload: object) =>
      app.inject({ method, url, payload });
    const mine = (
      await send("POST", "/api/filament-brands", { name: "ACME", url: "https://acme.example" })
    ).json();
    expect(mine.source).toBe("hand");
    // "How to sync" is for printers and spools: Overwrite changes nothing here.
    await send("PATCH", `/api/integrations/${id}`, {
      policies: [{ type: "filamentBrands", merge: "overwrite" }],
    });
    for (let i = 0; i < 2; i++) {
      expect(await run("filamentBrands")).toMatchObject({ created: 0, status: "ok" });
      expect((await app.inject(`/api/filament-brands/${mine.id}`)).json()).toMatchObject({
        name: "ACME",
        url: "https://acme.example",
        // The slicer's library, whichever of its installs brought it.
        source: "fake",
      });
    }
    expect((await app.inject("/api/filament-brands?source=fake")).json().total).toBe(1);
    const renamed = await send("PATCH", `/api/filament-brands/${mine.id}`, { name: "Acme Co" });
    expect([renamed.statusCode, renamed.json().error.code]).toEqual([409, "name_locked"]);
    const edited = await send("PATCH", `/api/filament-brands/${mine.id}`, {
      name: "ACME",
      url: "https://acme.example/en",
    });
    expect(edited.json()).toMatchObject({ url: "https://acme.example/en" });
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
    state.presets = [preset(), preset({ presetId: "system/B", name: "B" })];
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
    state.presets = [preset({ nozzleTempC: 230 }), preset({ presetId: "system/B", name: "B" })];
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
      .values({
        number: 1,
        name: "P",
        modelId: first?.printerModelId,
        machineProfileId: first?.id,
      })
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
    // A new default print profile alone is no new version: the print was made the same way.
    state.catalog.machines = [{ ...machine(0.6, "Acme X 0.6"), defaultPrintPreset: "system/Fine" }];
    await run("machineProfiles");
    expect(db.select().from(schema.machineProfiles).all()).toMatchObject([
      { id: first?.id, defaultPrintPreset: "fake:system/Fine", archivedAt: null },
    ]);
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
    // The printer follows the preset; the print keeps the version it was made with.
    const now = db.select().from(schema.printers).get();
    expect(now?.machineProfileId).toBe(rows.find((r) => r.id !== first?.id)?.id);
    expect(db.select().from(schema.prints).get()?.machineProfileId).toBe(first?.id);

    // The list hides the old version; the print still resolves it.
    const list = (await app.inject("/api/machine-profiles")).json();
    expect(list.items.map((m: { name: string }) => m.name)).toEqual(["Acme X 0.8"]);
    expect((await app.inject(`/api/machine-profiles/${first?.id}`)).json().archivedAt).toBeTruthy();
  });

  it("a sync imports print profiles, with or without a known printer, and updates them in place", async () => {
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
      { name: "Loose", printerModelId: null, sourcePreset: "fake:system/Loose" },
    ]);

    state.catalog.processes = state.catalog.processes
      .filter((p) => p.name === "Loose")
      .map((p) => ({ ...p, layerHeightMm: 0.32 }));
    await run("printProfiles");
    expect(db.select().from(schema.printProfiles).all()).toHaveLength(2);
    const loose = (await app.inject("/api/print-profiles?name=Loose")).json();
    expect(loose.items).toMatchObject([{ id: rows[1]?.id, layerHeightMm: 0.32 }]);
  });

  it("keeps every printer a process lists and a machine's default; a re-read fills rows you have", async () => {
    const two = { ...machine(0.4, "Acme Y 0.4"), presetId: "system/Acme Y 0.4" };
    await run("machineProfiles");
    await run("printProfiles");
    const standard = () =>
      db
        .select()
        .from(schema.printProfiles)
        .where(eq(schema.printProfiles.name, "0.20mm Standard @Acme X"))
        .get();
    expect(standard()?.machinePresets).toEqual(["fake:system/Acme X 0.4"]);

    // The slicer now says more: both machines, and a default.
    state.catalog.machines = [
      { ...machine(), defaultPrintPreset: "system/0.20mm Standard @Acme X" },
      two,
    ];
    const [first] = state.catalog.processes;
    if (first) first.machines = ["system/Acme X 0.4", "system/Acme Y 0.4"];
    const preview = await open("printProfiles");
    expect(preview.rows.find((r) => r.targetId === standard()?.id)).toMatchObject({
      status: "changed",
      values: { printers: "Acme X 0.4, Acme Y 0.4" },
    });
    await run("printProfiles");
    await run("machineProfiles");
    expect(standard()?.machinePresets).toEqual([
      "fake:system/Acme X 0.4",
      "fake:system/Acme Y 0.4",
    ]);
    const machines = db.select().from(schema.machineProfiles).all();
    expect(
      machines.find((m) => m.sourcePreset === "fake:system/Acme X 0.4")?.defaultPrintPreset,
    ).toBe("fake:system/0.20mm Standard @Acme X");
  });

  it("a printer added before its slicer's catalog gets its machine profile from the import", async () => {
    await run("brands");
    await run("printerModels");
    const model = db.select().from(schema.printerModels).get();
    const printer = await app.inject({
      method: "POST",
      url: "/api/printers",
      payload: { name: "P", modelId: model?.id },
    });
    expect(printer.json().machineProfileId).toBeNull();
    await run("machineProfiles");
    const made = db.select().from(schema.machineProfiles).get();
    expect(db.select().from(schema.printers).get()?.machineProfileId).toBe(made?.id);
  });

  it("a changed filament preset updates in place: no spool or print points at it", async () => {
    await run("filamentBrands");
    await run("filamentMaterials");
    // Confirms what the review suggests for the one preset.
    const imp = async () => review.confirm(await open("filamentProfiles"));
    await imp();
    const first = db.select().from(schema.filamentProfiles).get();

    state.presets = [preset({ nozzleTempC: 230 })];
    const status = async () => (await open("filamentProfiles")).rows[0]?.status;
    expect(await status()).toBe("changed");
    expect((await imp()).json()).toMatchObject({ created: 0, updated: 1 });
    expect(db.select().from(schema.filamentProfiles).all()).toMatchObject([
      { id: first?.id, nozzleTempC: 230, archivedAt: null },
    ]);
    expect(await status()).toBe("identical");

    // Prints and spools never point at a profile: a later change is in place too.
    state.presets = [preset({ nozzleTempC: 240 })];
    await imp();
    expect(db.select().from(schema.filamentProfiles).all()).toMatchObject([
      { id: first?.id, nozzleTempC: 240, archivedAt: null },
    ]);
  });

  it("the brand pick adds the models and profiles of those brands only, past 'only what I already have'", async () => {
    state.catalog.models.push({ brand: "Prusa", model: "MK4", image: null });
    state.catalog.machines.push({
      ...machine(),
      presetId: "system/MK4 0.4",
      brand: "Prusa",
      model: "MK4",
      name: "MK4 0.4",
    });
    state.presets = [preset(), preset({ presetId: "system/P", brand: "Prusament", name: "P" })];
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${id}`,
      payload: {
        policies: ["brands", "printerModels", "machineProfiles"].map((type) => ({
          type,
          scope: "imported",
        })),
      },
    });
    const offered = (await app.inject(`/api/import/catalog/${id}`)).json();
    expect(offered).toEqual({
      brands: [
        { name: "Acme", have: false },
        { name: "Prusa", have: false },
      ],
      filamentBrands: [
        { name: "Acme", have: false },
        { name: "Prusament", have: false },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/import/catalog/${id}`,
      payload: { brands: ["acme"], filamentBrands: ["Acme"] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const names = (rows: { name: string }[]) => rows.map((r) => r.name);
    expect(names(db.select().from(schema.brands).all())).toEqual(["Acme"]);
    expect(db.select().from(schema.printerModels).all()).toHaveLength(1);
    expect(names(db.select().from(schema.machineProfiles).all())).toEqual(["Acme X 0.4"]);
    // The process preset with no brand is no brand's.
    expect(names(db.select().from(schema.printProfiles).all())).toEqual([
      "0.20mm Standard @Acme X",
    ]);
    expect(names(db.select().from(schema.filamentBrands).all())).toEqual(["Acme"]);
    expect(names(db.select().from(schema.filamentProfiles).all())).toEqual(["A"]);
    // One of each of the seven types.
    expect(res.json().created).toBe(7);

    // Picking again adds nothing; the picker shows what you have.
    const again = await app.inject({
      method: "POST",
      url: `/api/import/catalog/${id}`,
      payload: { brands: ["Acme"], filamentBrands: [] },
    });
    expect(again.json().created).toBe(0);
    expect((await app.inject(`/api/import/catalog/${id}`)).json().brands).toEqual([
      { name: "Acme", have: true },
      { name: "Prusa", have: false },
    ]);
  });
});
