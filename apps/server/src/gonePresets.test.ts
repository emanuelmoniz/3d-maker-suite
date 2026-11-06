import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { type PresetKind, presetInUse } from "./lib/dependents.ts";
import { insertProfile } from "./testSeed.ts";

// ADR-0019 (Plan 5.4.0 Step 7): a preset gone from a slicer raises an alert, and its catalog row
// goes only when a person deletes it and nothing uses it.

const { filamentProfiles, machineProfiles, printProfiles, syncPolicies, syncRuns } = schema;

const state: { catalog: SlicerCatalog; presets: LibraryPreset[]; fingerprint: string } = {
  catalog: null as never,
  presets: [],
  fingerprint: "",
};
const machine = (name: string, scope: "system" | "user" = "system") => ({
  presetId: `${scope}/${name}`,
  scope,
  brand: "Acme",
  model: "Acme X",
  name,
  nozzleDiameterMm: 0.4,
  defaultPrintPreset: null,
});
const filament = (name: string, scope: "system" | "user" = "system"): LibraryPreset => ({
  presetId: `${scope}/${name}`,
  scope,
  brand: "Acme",
  material: "PLA",
  name,
  diameterMm: 1.75,
  densityGcm3: 1.24,
  nozzleTempC: 220,
  bedTempC: 55,
});

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dataDir: string;
let id: string;
let slicer: IntegrationAdapter;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "gone-"));
  state.catalog = {
    models: [{ brand: "Acme", model: "Acme X", image: null }],
    machines: [machine("Acme X 0.4"), machine("Acme X 0.6")],
    processes: [],
  };
  state.presets = [filament("A"), filament("B")];
  state.fingerprint = "Acme=1";
  const library: FilamentLibrary = {
    id: "fake",
    defaultDirs: () => [dataDir],
    read: async () => state.presets,
    readCatalog: async () => state.catalog,
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

const syncer = () => createSyncer(db, [slicer], loadKey(dataDir), app.log, dataDir);
const run = (type: string) =>
  app.inject({ method: "POST", url: `/api/integrations/${id}/sync`, payload: { type } });
const open = async (type: string) =>
  (
    await app.inject({ method: "POST", url: `/api/import/integration/${id}/${type}` })
  ).json() as ImportPreview;
const remove = (type: string, rowId: string) =>
  app.inject({ method: "DELETE", url: `/api/import/integration/${id}/${type}/gone/${rowId}` });
const pendingOf = (type: string) =>
  db
    .select()
    .from(syncPolicies)
    .all()
    .find((p) => p.type === type)?.pending ?? 0;
const alerts = async () => {
  await app.inject({ method: "POST", url: "/api/alerts/evaluate" });
  return (await app.inject("/api/alerts"))
    .json()
    .filter((a: { kind: string }) => a.kind === "sync_pending");
};
const lastLog = () =>
  db
    .select()
    .from(syncRuns)
    .all()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .at(-1)?.log;
const machineOf = (name: string) =>
  db.select().from(machineProfiles).where(eq(machineProfiles.name, name)).get();
const made = async (url: string, payload: object): Promise<string> => {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};

/** Both machine presets imported and the folder seen; then the slicer drops "Acme X 0.6". */
const dropMachine = async () => {
  for (const type of ["brands", "printerModels", "machineProfiles"]) await run(type);
  await syncer().checkCatalogs();
  state.catalog.machines = [machine("Acme X 0.4")];
  state.fingerprint = "Acme=2";
};

describe("a preset gone from the slicer", () => {
  it("raises an alert and deletes nothing; Delete removes an unused row after a person confirms", async () => {
    await dropMachine();
    await syncer().checkCatalogs();

    const gone = machineOf("Acme X 0.6");
    expect(gone?.archivedAt).toBeNull();
    expect(pendingOf("machineProfiles")).toBe(1);
    expect(await alerts()).toMatchObject([{ context: { type: "machineProfiles", count: 1 } }]);
    expect(lastLog()).toEqual([{ event: "left", label: "Acme X 0.6", reason: "removed" }]);

    const preview = await open("machineProfiles");
    expect(preview.gone).toEqual([{ id: gone?.id, label: "Acme X 0.6", dependents: [] }]);
    const res = await remove("machineProfiles", gone?.id ?? "");
    expect(res.json()).toEqual({ result: "deleted" });
    expect(machineOf("Acme X 0.6")).toBeUndefined();
    expect(machineOf("Acme X 0.4")).toBeDefined();
    expect(pendingOf("machineProfiles")).toBe(0);
    expect(await alerts()).toEqual([]);
    expect((await open("machineProfiles")).gone).toBeUndefined();
  });

  it("a used row can't be deleted and says why; once free, the alert asks again", async () => {
    await dropMachine();
    const used = machineOf("Acme X 0.6")?.id ?? "";
    const modelId = db.select().from(schema.printerModels).get()?.id;
    const printerId = await made("/api/printers", { name: "P1", modelId, state: "working" });
    const printId = await made("/api/prints", {
      printerId,
      machineProfileId: used,
      title: "Benchy",
      startedAt: "2026-01-01T10:00:00.000Z",
      outcome: "success",
    });
    await syncer().checkCatalogs();
    expect(pendingOf("machineProfiles")).toBe(1);

    const [why] = (await open("machineProfiles")).gone ?? [];
    expect(why?.dependents).toMatchObject([
      { type: "print", total: 1, items: [{ id: printId, label: expect.stringMatching(/Benchy/) }] },
    ]);
    const refused = await remove("machineProfiles", used);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("in_use");
    expect(machineOf("Acme X 0.6")).toBeDefined();

    // Kept: no Delete to offer, so the review closes and doesn't ask while it's used.
    const preview = await open("machineProfiles");
    const kept = await app.inject({
      method: "POST",
      url: "/api/import/machineProfiles/apply",
      payload: { uploadId: preview.uploadId, policy: "keepEdits", decisions: [] },
    });
    expect(kept.statusCode).toBe(200);
    expect(pendingOf("machineProfiles")).toBe(0);
    syncer().checkFreed();
    expect(pendingOf("machineProfiles")).toBe(0);
    expect(await alerts()).toEqual([]);

    expect((await app.inject({ method: "DELETE", url: `/api/prints/${printId}` })).statusCode).toBe(
      204,
    );
    syncer().checkFreed();
    expect(pendingOf("machineProfiles")).toBe(1);
    expect(await alerts()).toHaveLength(1);
    expect(lastLog()).toEqual([{ event: "left", label: "Acme X 0.6", reason: "removed" }]);
    // Asked once: the next tick doesn't count it again.
    syncer().checkFreed();
    expect(pendingOf("machineProfiles")).toBe(1);
    expect((await remove("machineProfiles", used)).json()).toEqual({ result: "deleted" });
  });

  it("a preset that comes back closes its alert", async () => {
    await dropMachine();
    await syncer().checkCatalogs();
    expect(await alerts()).toHaveLength(1);

    state.catalog.machines = [machine("Acme X 0.4"), machine("Acme X 0.6")];
    state.fingerprint = "Acme=3";
    await syncer().checkCatalogs();
    expect(pendingOf("machineProfiles")).toBe(0);
    expect(await alerts()).toEqual([]);
    expect((await open("machineProfiles")).gone).toBeUndefined();
  });

  it("an Automatic card deletes nothing either; Delete is refused while it is still there", async () => {
    await app.inject({
      method: "PATCH",
      url: `/api/integrations/${id}`,
      payload: { policies: [{ type: "machineProfiles", mode: "auto" }] },
    });
    await dropMachine();
    await syncer().checkCatalogs();
    expect(machineOf("Acme X 0.6")).toBeDefined();
    expect(pendingOf("machineProfiles")).toBe(1);
    // Not gone: nothing to delete.
    const kept = machineOf("Acme X 0.4")?.id ?? "";
    expect((await remove("machineProfiles", kept)).statusCode).toBe(404);
  });

  it("a slicer that reads empty counts nothing gone", async () => {
    await dropMachine();
    state.catalog.machines = [];
    await syncer().checkCatalogs();
    expect(pendingOf("machineProfiles")).toBe(0);
    expect((await open("machineProfiles")).gone).toBeUndefined();
  });

  it("a user preset gone from the folder waits for a person, with the presets that inherit from it", async () => {
    const dir = join(dataDir, "user", "default", "filament");
    mkdirSync(dir, { recursive: true });
    const save = (name: string, inherits?: string) =>
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({ name, inherits }));
    state.presets = [filament("A"), filament("Mine", "user"), filament("Other", "user")];
    save("Mine");
    save("Other");
    await syncer().checkUserPresets();
    expect(
      db
        .select()
        .from(filamentProfiles)
        .all()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Mine", "Other"]);

    // "Mine" goes in the slicer, "Child" still inherits from it.
    state.presets = [filament("A"), filament("Other", "user"), filament("Child", "user")];
    rmSync(join(dir, "Mine.json"));
    save("Child", "Mine");
    await syncer().checkUserPresets();

    expect(
      db
        .select()
        .from(filamentProfiles)
        .all()
        .map((p) => p.name),
    ).toContain("Mine");
    expect(pendingOf("userFilamentProfiles")).toBe(1);
    const [mine] = (await open("userFilamentProfiles")).gone ?? [];
    expect(mine).toMatchObject({
      label: "Acme PLA Mine",
      dependents: [{ type: "preset", total: 1, items: [{ label: "Child" }] }],
    });
    expect((await remove("userFilamentProfiles", mine?.id ?? "")).statusCode).toBe(409);
  });
});

describe("in use, by ADR-0019's stricter rule", () => {
  let n = 0;
  const unique = (name: string) => `${name} ${++n}`;
  const model = async () =>
    made("/api/printer-models", {
      brandId: await made("/api/brands", { name: unique("Brand") }),
      model: unique("X"),
    });
  const printer = async (fields: object = {}) =>
    made("/api/printers", {
      name: unique("P"),
      modelId: await model(),
      state: "working",
      ...fields,
    });
  const print = async (fields: object = {}) =>
    made("/api/prints", {
      printerId: await printer(),
      title: unique("Body"),
      startedAt: "2026-01-01T10:00:00.000Z",
      outcome: "success",
      ...fields,
    });
  const plate = async (fields: object) =>
    db
      .insert(schema.projectSlicePlates)
      .values({
        projectId: await made("/api/projects", { name: unique("Vase") }),
        file: "a.3mf",
        plate: 1,
        fileSize: 1,
        fileMtimeMs: 1,
        fileSha256: "x",
        ...fields,
      })
      .run();
  const items = {
    machineProfiles: async () =>
      insertProfile(db, "machineProfiles", { name: unique("M"), printerModelId: await model() }).id,
    printProfiles: async () => insertProfile(db, "printProfiles", { name: unique("Fine") }).id,
    filamentProfiles: async () =>
      insertProfile(db, "filamentProfiles", {
        materialId: await made("/api/filament-materials", { name: unique("PLA") }),
        name: unique("Basic"),
      }).id,
  };
  const LISTS = {
    machineProfiles: "/api/machine-profiles",
    printProfiles: "/api/print-profiles",
    filamentProfiles: "/api/filament/profiles",
  };
  /** The list's In use filter: the ids it lists as used. */
  const listedUsed = async (kind: PresetKind) =>
    ((await app.inject(`${LISTS[kind]}?use=used`)).json().items as { id: string }[]).map(
      (r) => r.id,
    );
  const TABLES = { machineProfiles, printProfiles, filamentProfiles };
  /** An archived row of the same preset: what prints of an older version point at. */
  const version = (kind: PresetKind) => async (rowId: string) => {
    const t = TABLES[kind] as typeof machineProfiles;
    db.update(t).set({ sourcePreset: "fake:system/P" }).where(eq(t.id, rowId)).run();
    const row = db.select().from(t).where(eq(t.id, rowId)).get();
    const {
      id: _,
      createdAt: __,
      updatedAt: ___,
      ...copy
    } = row as typeof machineProfiles.$inferSelect;
    db.insert(t)
      .values({ ...copy, archivedAt: "2026-01-01T00:00:00.000Z" })
      .run();
  };

  const uses: [PresetKind, string, (rowId: string) => Promise<unknown>][] = [
    ["machineProfiles", "print", (m) => print({ machineProfileId: m })],
    [
      "machineProfiles",
      "printer",
      async (m) =>
        db
          .update(schema.printers)
          .set({ machineProfileId: m })
          .where(eq(schema.printers.id, await printer()))
          .run(),
    ],
    ["machineProfiles", "machineProfile", version("machineProfiles")],
    ["printProfiles", "printer", (p) => printer({ printProfileId: p })],
    ["printProfiles", "plate", (p) => plate({ printProfileId: p })],
    ["printProfiles", "printProfile", version("printProfiles")],
    ["filamentProfiles", "plate", (f) => plate({ filaments: [null, f] })],
    ["filamentProfiles", "filamentProfile", version("filamentProfiles")],
  ];

  it.each(uses)("%s: a %s counts", async (kind, type, use) => {
    const rowId = await items[kind]();
    expect(presetInUse(db, undefined, kind, rowId)).toEqual([]);
    expect(await listedUsed(kind)).toEqual([]);
    await use(rowId);
    expect(presetInUse(db, undefined, kind, rowId)).toMatchObject([{ type, total: 1 }]);
    expect(await listedUsed(kind)).toEqual([rowId]);
  });

  it("a preset that inherits from it counts, by name", async () => {
    const rowId = await items.filamentProfiles();
    expect(presetInUse(db, undefined, "filamentProfiles", rowId, ["Child"])).toEqual([
      {
        type: "preset",
        total: 1,
        archived: 0,
        items: [{ id: "Child", label: "Child", archived: false }],
      },
    ]);
  });

  it("a plate links to its project", async () => {
    const rowId = await items.printProfiles();
    await plate({ printProfileId: rowId });
    const projectId = db.select().from(schema.projects).get()?.id;
    expect(presetInUse(db, undefined, "printProfiles", rowId)).toMatchObject([
      {
        type: "plate",
        items: [{ id: projectId, label: expect.stringMatching(/^Vase \d+ · a\.3mf #1$/) }],
      },
    ]);
  });
});
