import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bambuStudioWorkerAdapter } from "@3d-maker-suite/adapter-bambu";
import {
  orcaSlicerAdapter,
  orcaSlicerServerAdapter,
  orcaSlicerWorkerAdapter,
} from "@3d-maker-suite/adapter-orca";
import type { ImportPreview, SlicerPreset, SlicerPresetDetail } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { presetSha } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";
import { buildApp } from "./app.ts";
import { linkLibraries } from "./integrations/managedSlicer.ts";
import { presetsChanged, savePreset, usedPresets } from "./integrations/presetLibrary.ts";

const zipOf = (files: Record<string, string>) =>
  new Promise<Buffer>((resolve) => {
    const z = new yazl.ZipFile();
    for (const [name, data] of Object.entries(files)) z.addBuffer(Buffer.from(data), name);
    const chunks: Buffer[] = [];
    z.outputStream.on("data", (c) => chunks.push(c));
    z.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    z.end();
  });
const preset = (name: string, extra: object = {}) =>
  JSON.stringify({ name, inherits: "Generic PLA", filament_type: ["PLA"], ...extra }, null, 4);

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dataDir: string;

beforeEach(async () => {
  db = openDb(":memory:");
  dataDir = mkdtempSync(join(tmpdir(), "presets-"));
  app = await start();
  hub(true);
});

const ADAPTERS = [
  orcaSlicerAdapter(),
  orcaSlicerServerAdapter(),
  orcaSlicerWorkerAdapter(),
  bambuStudioWorkerAdapter(),
];
const start = async () => {
  const a = await buildApp(db, false, dataDir, { adapters: ADAPTERS });
  await a.ready();
  return a;
};
// Set directly: the API turns the hub on only with user accounts.
const hub = (on: boolean) =>
  db
    .insert(schema.settings)
    .values({ key: "hubEnabled", value: on })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: on } })
    .run();

const upload = async (files: Record<string, string>) =>
  app.inject({
    method: "POST",
    url: "/api/slicer-zip/orca-slicer",
    headers: { "content-type": "application/zip" },
    payload: await zipOf(files),
  });
const addSlicer = async (adapterId: string, config?: object) =>
  (
    await app.inject({ method: "POST", url: "/api/integrations", payload: { adapterId, config } })
  ).json().id as string;
const list = async () => (await app.inject("/api/presets")).json() as SlicerPreset[];
const userDir = (id: string) => join(dataDir, "slicers", id, "config", "user", "default");

// What a slicer really saves: only what differs from its parent, here without a `filament_type`.
const realPreset = (name: string) =>
  JSON.stringify({ name, inherits: "Generic PLA", filament_settings_id: [name] }, null, 4);
const offered = async (id: string) => {
  const res = await app.inject({
    method: "POST",
    url: `/api/import/integration/${id}/filamentProfiles`,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as ImportPreview).rows.map((r) => r.values.name);
};

// ADR-0019: the known gap, three separate causes. Plan 5.4.0 Step 5 turns these into normal tests.
describe("a shared preset reaches the catalog", () => {
  const share = (library: string) =>
    savePreset(db, dataDir, {
      library,
      kind: "filament",
      name: "Shared",
      json: realPreset("Shared"),
    });

  // capability_unavailable: a worker can only `slice`, of either slicer.
  it.fails("on a worker-only hub", async () => {
    const worker = await addSlicer("bambu-studio-worker", {
      deviceId: crypto.randomUUID(),
      source: "installed",
    });
    linkLibraries(db, dataDir, ADAPTERS);
    share("bambu-studio");
    expect(await offered(worker)).toContain("Shared");
  });

  // capability_unavailable: Orca's server adapter can only `slice` too, unlike Bambu's.
  it.fails("on an Orca hub", async () => {
    const server = await addSlicer("orca-slicer-server");
    linkLibraries(db, dataDir, ADAPTERS);
    share("orca-slicer");
    expect(await offered(server)).toContain("Shared");
  });

  // The row is missing: with no readable system preset nothing resolves `filament_type`, so the
  // reader drops it without a word.
  it.fails("on a desktop Orca, whose system presets are .opc files", async () => {
    const config = join(dataDir, "desktop-orca");
    mkdirSync(join(config, "user", "default", "filament"), { recursive: true });
    writeFileSync(join(config, "user", "default", "filament", "Shared.json"), realPreset("Shared"));
    const desktop = await addSlicer("orca-slicer");
    db.update(schema.integrations)
      .set({ slicerConfigDir: config })
      .where(eq(schema.integrations.id, desktop))
      .run();
    expect(await offered(desktop)).toContain("Shared");
  });
});

describe("hub preset library (ADR-0017)", () => {
  it("merges zips from two PCs; the server slicer and a worker read the library", async () => {
    const server = await addSlicer("orca-slicer-server");
    const worker = await addSlicer("orca-slicer-worker", {
      deviceId: crypto.randomUUID(),
      source: "installed",
    });
    // PC 1, signed in; PC 2, signed out with one name in common.
    expect(
      (
        await upload({
          "user/123/filament/Mine.json": preset("Mine"),
          "user/123/filament/Mine.info": "sync_info = create",
          "user/123/process/Fast.json": JSON.stringify({ name: "Fast" }),
        })
      ).statusCode,
    ).toBe(200);
    await upload({
      "user/default/filament/Theirs.json": preset("Theirs"),
      "user/default/filament/Mine.json": preset("Mine", { filament_cost: ["20"] }),
    });

    const all = await list();
    expect(all.map((p) => `${p.kind}/${p.name} v${p.version}`).sort()).toEqual([
      "filament/Mine v2",
      "filament/Theirs v1",
      "process/Fast v1",
    ]);
    expect(all.find((p) => p.name === "Mine")).toMatchObject({
      library: "orca-slicer",
      inherits: "Generic PLA",
      conflict: false,
    });
    for (const id of [server, worker]) {
      expect(lstatSync(join(dataDir, "slicers", id, "config", "user")).isSymbolicLink()).toBe(true);
      expect(readdirSync(join(userDir(id), "filament")).sort()).toEqual([
        "Mine.json",
        "Theirs.json",
      ]);
    }

    // The same content again (other whitespace) is no change.
    await upload({
      "user/default/filament/Theirs.json": JSON.stringify(JSON.parse(preset("Theirs"))),
    });
    expect((await list()).find((p) => p.name === "Theirs")?.version).toBe(1);

    const mine = all.find((p) => p.name === "Mine") as SlicerPreset;
    const detail = (await app.inject(`/api/presets/${mine.id}`)).json() as SlicerPresetDetail;
    expect(detail.versions.map((v) => v.version)).toEqual([1]);
    const old = await app.inject(`/api/presets/${mine.id}/download?version=1`);
    expect(old.headers["content-disposition"]).toContain("Mine.json");
    expect(JSON.parse(old.body).filament_cost).toBeUndefined();
  });

  it("a hub delete disappears from a worker; a zip brings it back as the next version", async () => {
    const worker = await addSlicer("orca-slicer-worker", {
      deviceId: crypto.randomUUID(),
      source: "installed",
    });
    await upload({ "user/default/filament/Mine.json": preset("Mine") });
    const [mine] = await list();
    const file = join(userDir(worker), "filament", "Mine.json");
    expect(existsSync(file)).toBe(true);

    expect(
      (await app.inject({ method: "DELETE", url: `/api/presets/${mine?.id}` })).statusCode,
    ).toBe(204);
    expect(existsSync(file)).toBe(false);
    expect(await list()).toEqual([]);
    expect((await app.inject(`/api/presets/${mine?.id}`)).statusCode).toBe(404);

    await upload({ "user/default/filament/Mine.json": preset("Mine") });
    expect((await list())[0]?.version).toBe(2);
    expect(existsSync(file)).toBe(true);
  });

  it("skips json that doesn't parse, with an alert; nil values are fine", async () => {
    await upload({
      "user/default/filament/Broken.json": "{ not json",
      "user/default/filament/Nil.json": preset("Nil", { filament_cost: "nil" }),
    });
    expect((await list()).map((p) => p.name)).toEqual(["Nil"]);
    const alerts = db.select().from(schema.alerts).all();
    expect(alerts.map((a) => [a.kind, a.context.name, a.context.reason])).toEqual([
      ["preset_skipped", "Broken", "invalid_json"],
    ]);
  });

  it("merges a server slicer's own config/user (a zip before 0090) when it links it", async () => {
    // Imported with the hub off: a real folder, as before.
    hub(false);
    const server = await addSlicer("orca-slicer-server");
    await upload({ "user/default/process/Old.json": JSON.stringify({ name: "Old" }) });
    const user = join(dataDir, "slicers", server, "config", "user");
    expect(lstatSync(user).isSymbolicLink()).toBe(false);
    expect(await list()).toEqual([]);

    // The next start with the hub on.
    hub(true);
    await app.close();
    app = await start();
    expect(lstatSync(user).isSymbolicLink()).toBe(true);
    expect((await list()).map((p) => p.name)).toEqual(["Old"]);
    expect(readdirSync(join(user, "default", "process"))).toEqual(["Old.json"]);
  });

  it("rebuilds the folder from the table at start", async () => {
    await upload({ "user/default/filament/Mine.json": preset("Mine") });
    const stray = join(dataDir, "presets", "orca-slicer", "default", "filament", "Stray.json");
    writeFileSync(stray, "{}");
    mkdirSync(join(dataDir, "presets", "gone", "default"), { recursive: true });
    await app.close();
    app = await start();
    expect(readdirSync(join(dataDir, "presets", "orca-slicer", "default", "filament"))).toEqual([
      "Mine.json",
    ]);
  });

  it("a changed or deleted preset outdates the slices that used it, and only those", async () => {
    await upload({
      "user/default/filament/Mine.json": preset("Mine"),
      "user/default/process/Fast.json": JSON.stringify({ name: "Fast" }),
    });
    const used = usedPresets(db, "orca-slicer", {
      file: "x.3mf",
      plate: 1,
      process: "system/0.20mm",
      filaments: ["user/Mine", null],
    });
    expect(Object.values(used)).toEqual([presetSha(JSON.parse(preset("Mine")))]);
    const stale = presetsChanged(db);
    expect(stale({ slicedPresets: used })).toBe(false);
    expect(stale({ slicedPresets: null })).toBe(false);

    await upload({ "user/default/process/Fast.json": JSON.stringify({ name: "Fast", x: 1 }) });
    expect(presetsChanged(db)({ slicedPresets: used })).toBe(false);
    await upload({ "user/default/filament/Mine.json": preset("Mine", { filament_cost: ["9"] }) });
    expect(presetsChanged(db)({ slicedPresets: used })).toBe(true);

    // The projects list says so too (its own SQL).
    const project = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "P" } })
    ).json();
    const plate = (slicedPresets: Record<string, string>) =>
      db
        .insert(schema.projectSlicePlates)
        .values({
          projectId: project.id,
          file: "a.3mf",
          plate: 1,
          fileSize: 1,
          fileMtimeMs: 1,
          fileSha256: "x",
          slicedAt: new Date().toISOString(),
          slicedPresets,
        })
        .onConflictDoUpdate({
          target: [
            schema.projectSlicePlates.projectId,
            schema.projectSlicePlates.file,
            schema.projectSlicePlates.plate,
          ],
          set: { slicedPresets },
        })
        .run();
    const slicing = async () =>
      ((await app.inject("/api/projects")).json().items as { slicing: string }[])[0]?.slicing;
    plate(used);
    expect(await slicing()).toBe("needed");
    plate(usedPresets(db, "orca-slicer", { file: "x.3mf", plate: 1, filaments: ["user/Mine"] }));
    expect(await slicing()).toBe("done");

    const fresh = usedPresets(db, "orca-slicer", {
      file: "x.3mf",
      plate: 1,
      filaments: ["user/Mine"],
    });
    const [id] = Object.keys(fresh);
    await app.inject({ method: "DELETE", url: `/api/presets/${id}` });
    expect(presetsChanged(db)({ slicedPresets: fresh })).toBe(true);
  });
});
