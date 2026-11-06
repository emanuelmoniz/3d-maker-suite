import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bambuStudioWorkerAdapter } from "@3d-maker-suite/adapter-bambu";
import {
  orcaSlicerAdapter,
  orcaSlicerServerAdapter,
  orcaSlicerWorkerAdapter,
} from "@3d-maker-suite/adapter-orca";
import {
  BUILT_IN_ROLE_IDS,
  type ImportPreview,
  type SlicerPreset,
  type SlicerPresetDetail,
} from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { loadKey, presetSha } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import yazl from "yazl";
import { buildApp } from "./app.ts";
import { keepPresets, linkLibraries } from "./integrations/managedSlicer.ts";
import {
  mergeUserPresets,
  presetsChanged,
  presetsRemoved,
  presetUses,
  rebuildLibraries,
  recheckRemovals,
  savePreset,
  uploadPreset,
  usedPresets,
} from "./integrations/presetLibrary.ts";
import { createSyncer } from "./integrations/sync.ts";
import { hashPassword } from "./lib/password.ts";
import { reviewer } from "./testReview.ts";

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
    url: `/api/import/integration/${id}/userFilamentProfiles`,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as ImportPreview).rows.map((r) => r.values.name);
};

// ADR-0019's catalog gap, three separate causes.
describe("a shared preset reaches the catalog", () => {
  const share = (library: string) =>
    savePreset(db, dataDir, {
      library,
      kind: "filament",
      name: "Shared",
      json: realPreset("Shared"),
    });

  it("on a worker-only hub", async () => {
    const worker = await addSlicer("bambu-studio-worker", {
      deviceId: crypto.randomUUID(),
      source: "installed",
    });
    linkLibraries(db, dataDir, ADAPTERS);
    share("bambu-studio");
    expect(await offered(worker)).toContain("Shared");
  });

  it("on an Orca hub", async () => {
    const server = await addSlicer("orca-slicer-server");
    linkLibraries(db, dataDir, ADAPTERS);
    share("orca-slicer");
    expect(await offered(server)).toContain("Shared");
  });

  // With no readable system preset nothing resolves `filament_type`: the row waits for a person.
  it("on a desktop Orca, whose system presets are .opc files", async () => {
    const { id } = await desktopOrca();
    saveFile("Shared", realPreset("Shared"));
    expect(await offered(id)).toContain("Shared");
  });
});

/** A desktop Orca row, with the folder its presets are saved in. */
const desktopConfig = () => join(dataDir, "desktop-orca");
const saveFile = (name: string, text: string) => {
  const dir = join(desktopConfig(), "user", "default", "filament");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), text);
};
const desktopOrca = async () => {
  mkdirSync(desktopConfig(), { recursive: true });
  const id = await addSlicer("orca-slicer");
  db.update(schema.integrations)
    .set({ slicerConfigDir: desktopConfig() })
    .where(eq(schema.integrations.id, id))
    .run();
  return { id };
};

describe("user presets reach the catalog on their own (ADR-0019)", () => {
  const { deletedSources, filamentProfiles, syncPolicies, syncRuns } = schema;
  const syncer = () => createSyncer(db, ADAPTERS, loadKey(dataDir), app.log, dataDir);
  const profiles = () => db.select().from(filamentProfiles).all();
  const runs = () => db.select().from(syncRuns).all().length;
  const review = reviewer(() => app);
  const save = (name: string, extra: object = {}) =>
    savePreset(db, dataDir, {
      library: "bambu-studio",
      kind: "filament",
      name,
      json: preset(name, { filament_vendor: ["Acme"], filament_cost: ["20"], ...extra }),
    });
  const addWorker = () =>
    addSlicer("bambu-studio-worker", { deviceId: crypto.randomUUID(), source: "installed" });
  const pendingOf = (id: string) =>
    db
      .select()
      .from(syncPolicies)
      .all()
      .find((p) => p.integrationId === id && p.type === "userFilamentProfiles")?.pending ?? 0;
  const setCard = (id: string, change: object) =>
    app.inject({
      method: "PATCH",
      url: `/api/integrations/${id}`,
      payload: { policies: [{ type: "userFilamentProfiles", ...change }] },
    });
  const sent = async () => {
    await app.inject({ method: "POST", url: "/api/alerts/evaluate" });
    const alerts = (await app.inject("/api/alerts")).json() as { kind: string; task: string }[];
    return alerts.filter((a) => a.kind === "sync_pending").map((a) => a.task);
  };

  it("a hub's saved preset arrives, with its brand and material; nothing changed logs nothing", async () => {
    await addWorker();
    save("Mine");
    const s = syncer();
    await s.checkUserPresets();

    expect(profiles()).toMatchObject([{ name: "Mine", sourcePreset: "bambu-studio:user/Mine" }]);
    expect(db.select().from(schema.filamentBrands).all()).toMatchObject([{ name: "Acme" }]);
    expect(db.select().from(schema.filamentMaterials).all()).toMatchObject([{ name: "PLA" }]);

    const logged = runs();
    await s.checkUserPresets();
    expect(runs()).toBe(logged);
  });

  it("a saved zip reaches the catalog without waiting for the tick", async () => {
    await addSlicer("orca-slicer-server");
    await upload({ "user/default/filament/Zipped.json": preset("Zipped") });
    await vi.waitFor(() => expect(profiles()).toMatchObject([{ name: "Zipped" }]), {
      timeout: 5000,
    });
  });

  it("an edit in the slicer updates the row in place", async () => {
    await addWorker();
    save("Mine", { nozzle_temperature: ["220"] });
    const s = syncer();
    await s.checkUserPresets();
    const [first] = profiles();
    expect(first).toMatchObject({ nozzleTempC: 220 });

    save("Mine", { nozzle_temperature: ["240"] });
    await s.checkUserPresets();

    expect(profiles()).toMatchObject([{ id: first?.id, nozzleTempC: 240 }]);
  });

  it("a row you deleted stays away, through a restart, until its preset is edited", async () => {
    await addWorker();
    save("Mine");
    const s = syncer();
    await s.checkUserPresets();
    const [row] = profiles();
    const res = await app.inject({ method: "DELETE", url: `/api/filament/profiles/${row?.id}` });
    expect(res.statusCode, res.body).toBe(204);

    // A start rewrites the library's files: no edit, and no change to look at.
    const seen = () =>
      db
        .select()
        .from(syncPolicies)
        .all()
        .find((p) => p.type === "userFilamentProfiles")?.cursor;
    const before = seen();
    rebuildLibraries(db, dataDir);
    await s.checkUserPresets();
    expect(seen()).toBe(before);
    expect(profiles()).toEqual([]);
    expect(db.select().from(deletedSources).all()).toMatchObject([
      { entity: "filamentProfiles", source: "bambu-studio:user/Mine" },
    ]);

    save("Mine", { nozzle_temperature: ["240"] });
    await s.checkUserPresets();
    expect(profiles()).toMatchObject([{ name: "Mine", nozzleTempC: 240 }]);
    expect(db.select().from(deletedSources).all()).toEqual([]);
  });

  it("a preset with no readable parent waits for a person, once", async () => {
    const { id } = await desktopOrca();
    saveFile("Shared", realPreset("Shared"));
    const s = syncer();
    await s.checkUserPresets();

    expect(profiles()).toEqual([]);
    expect(pendingOf(id)).toBe(1);
    expect(await sent()).toEqual([`sync:${id}:userFilamentProfiles`]);

    // Filled in by hand in the review.
    const preview = (
      await review.open(`/api/import/integration/${id}/userFilamentProfiles`)
    ).json();
    const res = await app.inject({
      method: "POST",
      url: "/api/import/filamentProfiles/apply",
      payload: {
        uploadId: preview.uploadId,
        policy: "overwrite",
        decisions: [{ row: preview.rows[0].row, action: "create", values: { material: "PLA" } }],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(profiles()).toMatchObject([{ name: "Shared", sourcePreset: "orca-slicer:user/Shared" }]);
    expect(pendingOf(id)).toBe(0);

    // The file moves on, its parent still unreadable: nothing asks again.
    saveFile("Shared", `${realPreset("Shared")} `);
    await s.checkUserPresets();
    expect(pendingOf(id)).toBe(0);
    expect(profiles()).toHaveLength(1);
  });

  it("a hub PC's own slicer shares into the library, which is then its one route", async () => {
    const { id } = await desktopOrca();
    const server = await addSlicer("orca-slicer-server");
    saveFile("Mine", preset("Mine"));
    const s = syncer();
    // The library's own check may see the merge only at the next tick.
    await s.checkUserPresets();
    await s.checkUserPresets();

    expect((await list()).map((p) => [p.name, p.owner])).toEqual([["Mine", null]]);
    expect(profiles()).toMatchObject([{ name: "Mine", sourcePreset: "orca-slicer:user/Mine" }]);
    // Counted and imported by the library's row only.
    expect(pendingOf(id)).toBe(0);
    const from = db.select().from(schema.importSnapshots).all();
    expect([...new Set(from.map((r) => r.integrationId))]).toEqual([server]);
  });

  it("a single PC's file arrives, and a restart has nothing to read again", async () => {
    hub(false);
    await desktopOrca();
    saveFile("Mine", preset("Mine"));
    await syncer().checkUserPresets();
    expect(profiles()).toMatchObject([{ name: "Mine", sourcePreset: "orca-slicer:user/Mine" }]);

    const logged = runs();
    await syncer().checkUserPresets();
    expect(runs()).toBe(logged);
  });

  it("a desktop row you deleted stays away until its file is edited, whatever 'how to sync' says", async () => {
    const { id } = await desktopOrca();
    saveFile("Mine", preset("Mine"));
    const s = syncer();
    await s.checkUserPresets();
    await setCard(id, { merge: "review" });
    const [row] = profiles();
    const res = await app.inject({ method: "DELETE", url: `/api/filament/profiles/${row?.id}` });
    expect(res.statusCode, res.body).toBe(204);

    // Another preset's change looks at the folder again: this one stays away.
    saveFile("Other", preset("Other"));
    await s.checkUserPresets();
    expect(profiles().map((p) => p.name)).toEqual(["Other"]);

    saveFile("Mine", preset("Mine", { nozzle_temperature: ["240"] }));
    const later = new Date(Date.now() + 2000);
    utimesSync(join(desktopConfig(), "user", "default", "filament", "Mine.json"), later, later);
    await s.checkUserPresets();
    expect(
      profiles()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Mine", "Other"]);
    expect(pendingOf(id)).toBe(0);
  });

  it("Automatic, 'only what I already have': an edit updates, a new preset alerts and waits", async () => {
    const { id } = await desktopOrca();
    saveFile("Mine", preset("Mine", { nozzle_temperature: ["220"] }));
    const s = syncer();
    await s.checkUserPresets();
    expect(profiles()).toMatchObject([{ name: "Mine", nozzleTempC: 220 }]);
    await setCard(id, { scope: "imported" });

    saveFile("Mine", preset("Mine", { nozzle_temperature: ["240"] }));
    await s.checkUserPresets();
    expect(profiles()).toMatchObject([{ name: "Mine", nozzleTempC: 240 }]);
    expect(pendingOf(id)).toBe(0);

    saveFile("New", preset("New"));
    await s.checkUserPresets();
    expect(profiles()).toHaveLength(1);
    expect(pendingOf(id)).toBe(1);
    expect(await sent()).toEqual([`sync:${id}:userFilamentProfiles`]);

    // Skipped in the review it stays new: no asking on every check, only at the next file change.
    const preview = await review.open(`/api/import/integration/${id}/userFilamentProfiles`);
    expect((await review.confirm(preview.json(), [])).statusCode).toBe(200);
    expect(pendingOf(id)).toBe(0);
    await s.checkUserPresets();
    expect(pendingOf(id)).toBe(0);
    saveFile("Other", preset("Other"));
    await s.checkUserPresets();
    expect(pendingOf(id)).toBe(2);

    // Back to everything: at the next file change, they arrive.
    await setCard(id, { scope: "all" });
    saveFile("Other", `${preset("Other")} `);
    await s.checkUserPresets();
    expect(profiles().map((p) => p.name)).toEqual(["Mine", "New", "Other"]);
    expect(pendingOf(id)).toBe(0);
  });

  it("Manual: an edit and a new preset both alert and write nothing", async () => {
    const { id } = await desktopOrca();
    saveFile("Mine", preset("Mine", { nozzle_temperature: ["220"] }));
    const s = syncer();
    await s.checkUserPresets();
    await setCard(id, { mode: "manual" });

    saveFile("Mine", preset("Mine", { nozzle_temperature: ["240"] }));
    saveFile("New", preset("New"));
    await s.checkUserPresets();
    expect(profiles()).toMatchObject([{ name: "Mine", nozzleTempC: 220 }]);
    expect(pendingOf(id)).toBe(2);
    expect(await sent()).toEqual([`sync:${id}:userFilamentProfiles`]);

    // Back to Automatic: nothing changed since, so the next change runs it.
    await setCard(id, { mode: "auto" });
    saveFile("Mine", preset("Mine", { nozzle_temperature: ["250"] }));
    await s.checkUserPresets();
    expect(profiles()).toMatchObject([{ name: "Mine", nozzleTempC: 250 }, { name: "New" }]);
    expect(pendingOf(id)).toBe(0);
  });

  it("the cards only decide catalog rows: the hub's library keeps every preset for Install", async () => {
    const worker = await addWorker();
    await setCard(worker, { mode: "manual" });
    save("Mine");
    await syncer().checkUserPresets();
    expect(profiles()).toEqual([]);
    expect(db.select().from(schema.slicerPresets).all()).toMatchObject([{ name: "Mine" }]);
  });
});

it("a zip keeps Orca's system caches", async () => {
  const res = await upload({
    "system/Acme.opc": "binary",
    "system/orca_plugins/plugin.dll": "not a preset",
  });
  expect(res.statusCode, res.body).toBe(200);
  const files = readdirSync(dataDir, { recursive: true, encoding: "utf8" });
  expect(files.some((f) => f.endsWith("Acme.opc"))).toBe(true);
  expect(files.some((f) => f.endsWith("plugin.dll"))).toBe(false);
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

describe("deletes reach other machines (ADR-0019)", () => {
  const LIB = "bambu-studio";
  // Users turn sign-in on: an admin's session for the requests.
  let cookie = "";
  beforeEach(async () => {
    db.insert(schema.users)
      .values({
        email: "admin@x.io",
        displayName: "Admin",
        roleId: BUILT_IN_ROLE_IDS.admin,
        passwordHash: await hashPassword("password123"),
      })
      .run();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@x.io", password: "password123" },
    });
    cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
  });
  const send = (method: "GET" | "POST" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });
  const listed = async () => (await send("GET", "/api/presets")).json() as SlicerPreset[];
  const user = (name: string) =>
    db
      .insert(schema.users)
      .values({
        email: `${name}@x.io`,
        displayName: name,
        roleId: BUILT_IN_ROLE_IDS.admin,
        passwordHash: "x",
      })
      .returning()
      .get();
  const device = (name: string, userId: string, accounts: Record<string, string> = {}) =>
    db
      .insert(schema.devices)
      .values({ name, userId, tokenHash: crypto.randomUUID(), presetAccounts: accounts })
      .returning()
      .get();
  /** Shared from a device: its user owns it. */
  const shared = (name: string, d: { id: string; name: string; userId: string }, json?: string) =>
    uploadPreset(
      db,
      dataDir,
      { library: LIB, kind: "process", name, base: 0, text: json ?? JSON.stringify({ name }) },
      d.id,
      { device: d.name, userId: d.userId },
    );
  const row = (name: string) =>
    db
      .select()
      .from(schema.slicerPresets)
      .all()
      .find((r) => r.name === name);
  const removed = (d: { id: string; userId: string }, names: string[], account = "default") =>
    presetsRemoved(
      db,
      dataDir,
      { library: LIB, account, removed: names.map((name) => ({ kind: "process" as const, name })) },
      d,
      { device: "x" },
    ).map((r) => r.result);

  it("the first save owns a preset, a zip's uploader too; a hub PC's merge nobody", () => {
    const ana = user("Ana");
    const pc = device("Studio PC", ana.id);
    shared("Fast", pc);
    expect(row("Fast")?.ownerUserId).toBe(ana.id);
    // A later save by someone else doesn't take it over.
    const bo = user("Bo");
    shared("Fast", device("Farm PC", bo.id), JSON.stringify({ name: "Fast", x: 1 }));
    expect(row("Fast")?.ownerUserId).toBe(ana.id);

    const root = mkdtempSync(join(tmpdir(), "zip-"));
    mkdirSync(join(root, "user", "default", "process"), { recursive: true });
    writeFileSync(join(root, "user", "default", "process", "Zipped.json"), '{"name":"Zipped"}');
    keepPresets(db, dataDir, ADAPTERS, LIB, root, { userId: bo.id });
    expect(row("Zipped")?.ownerUserId).toBe(bo.id);

    const local = mkdtempSync(join(tmpdir(), "local-"));
    mkdirSync(join(local, "123", "process"), { recursive: true });
    writeFileSync(join(local, "123", "process", "Mine.json"), '{"name":"Mine"}');
    mergeUserPresets(db, dataDir, LIB, local);
    expect(row("Mine")?.ownerUserId).toBeNull();
  });

  it("the owner's removal deletes a free preset; another user's, or none's, changes nothing", () => {
    const ana = user("Ana");
    const bo = user("Bo");
    const a = device("Studio PC", ana.id);
    const b = device("Farm PC", bo.id);
    shared("Fast", a);
    savePreset(db, dataDir, { library: LIB, kind: "process", name: "Old", json: '{"name":"Old"}' });

    expect(removed(b, ["Fast", "Old", "Nope"])).toEqual(["kept", "kept", "unknown"]);
    expect(removed(a, ["Old"])).toEqual(["kept"]);
    expect(row("Fast")).toMatchObject({ deleted: false, removedOn: [] });
    expect(row("Old")).toMatchObject({ deleted: false, removedOn: [] });

    expect(removed(a, ["Fast"])).toEqual(["deleted"]);
    expect(row("Fast")).toMatchObject({ deleted: true, removedOn: [], savedDevice: "x" });
  });

  it("one in use waits for the daily check; a parent waits for its child", async () => {
    const ana = user("Ana");
    const a = device("Studio PC", ana.id);
    shared("Fast", a);
    shared("Base", a);
    shared("Child", a, JSON.stringify({ name: "Child", inherits: "Base" }));
    const profile = db
      .insert(schema.printProfiles)
      .values({ name: "Fast", sourcePreset: `${LIB}:user/Fast` })
      .returning()
      .get();
    const project = (await send("POST", "/api/projects", { name: "P" })).json();
    db.insert(schema.projectSlicePlates)
      .values({
        projectId: project.id,
        file: "a.3mf",
        plate: 1,
        fileSize: 1,
        fileMtimeMs: 1,
        fileSha256: "x",
        printProfileId: profile.id,
      })
      .run();
    expect(presetUses(db, { library: LIB, kind: "process", name: "Fast" })).toMatchObject([
      { type: "plate", total: 1 },
    ]);
    expect(presetUses(db, { library: LIB, kind: "process", name: "Base" })).toMatchObject([
      { type: "preset", items: [{ label: "Child" }] },
    ]);

    expect(removed(a, ["Fast", "Base"])).toEqual(["in_use", "in_use"]);
    expect(row("Fast")).toMatchObject({ deleted: false, removedOn: [a.id] });
    // The list says what keeps it.
    expect((await listed()).find((p) => p.name === "Fast")).toMatchObject({
      removedOn: ["Studio PC"],
      usedBy: [{ type: "plate" }],
    });
    expect(recheckRemovals(db, dataDir)).toBe(0);

    db.update(schema.projectSlicePlates).set({ printProfileId: null }).run();
    expect(removed(a, ["Child"])).toEqual(["deleted"]);
    expect(recheckRemovals(db, dataDir)).toBe(2);
    expect([row("Fast")?.deleted, row("Base")?.deleted]).toEqual([true, true]);
  });

  it("holds a mass delete and a shared account's; the owner's own PCs don't hold", () => {
    db.insert(schema.settings).values({ key: "hubDeleteGuard", value: 1 }).run();
    const ana = user("Ana");
    const bo = user("Bo");
    const a = device("Studio PC", ana.id, { [LIB]: "123" });
    const a2 = device("Laptop", ana.id, { [LIB]: "123" });
    for (const n of ["P1", "P2", "P3", "P4"]) shared(n, a);

    // The owner's laptop on the same account: no hold.
    expect(removed(a2, ["P1"], "123")).toEqual(["deleted"]);
    // More at once than the guard.
    expect(removed(a, ["P2", "P3", "Nope"])).toEqual(["held", "held", "unknown"]);
    expect(row("P2")).toMatchObject({ heldBy: a.id, heldReason: "mass", removedOn: [a.id] });

    // Another user's device on that account.
    device("Farm PC", bo.id, { [LIB]: "123" });
    expect(removed(a, ["P4"], "123")).toEqual(["held"]);
    expect(row("P4")).toMatchObject({ heldBy: a.id, heldReason: "shared" });
    expect(recheckRemovals(db, dataDir)).toBe(0);
  });

  it("a held removal is deleted or kept by a person; the file coming back ends it", async () => {
    db.insert(schema.settings).values({ key: "hubDeleteGuard", value: 1 }).run();
    const ana = user("Ana");
    const bo = user("Bo");
    const a = device("Studio PC", ana.id, { [LIB]: "123" });
    device("Farm PC", bo.id, { [LIB]: "123" });
    shared("P1", a);
    shared("P2", a);
    shared("Shared", a);
    expect(removed(a, ["Shared"], "123")).toEqual(["held"]);
    expect((await listed()).find((p) => p.name === "Shared")?.held).toEqual({
      deviceId: a.id,
      device: "Studio PC",
      reason: "shared",
    });
    // The file is back on that device: no removal any more.
    shared("Shared", a);
    expect(row("Shared")).toMatchObject({ heldBy: null, removedOn: [] });

    expect(removed(a, ["P1", "P2"])).toEqual(["held", "held"]);
    const held = (action: string) => send("POST", `/api/presets/devices/${a.id}/held`, { action });
    expect((await held("keep")).statusCode).toBe(204);
    expect(row("P1")).toMatchObject({ deleted: false, heldBy: null, removedOn: [] });

    expect(removed(a, ["P1", "P2"])).toEqual(["held", "held"]);
    expect((await held("delete")).statusCode).toBe(204);
    expect([row("P1")?.deleted, row("P2")?.deleted]).toEqual([true, true]);
  });

  it("Restore brings back a deleted preset or an earlier version, as the next version", async () => {
    const ana = user("Ana");
    const a = device("Studio PC", ana.id);
    shared("Fast", a, JSON.stringify({ name: "Fast", speed: 1 }));
    const json = JSON.stringify({ name: "Fast", speed: 2 });
    savePreset(db, dataDir, { library: LIB, kind: "process", name: "Fast", json });
    const id = row("Fast")?.id;
    expect((await send("DELETE", `/api/presets/${id}`)).statusCode).toBe(204);
    const deleted = (await send("GET", "/api/presets/deleted")).json() as SlicerPreset[];
    expect(deleted.map((p) => p.name)).toEqual(["Fast"]);

    const restore = (payload: object) => send("POST", `/api/presets/${id}/restore`, payload);
    const back = await restore({});
    expect(back.json()).toMatchObject({ name: "Fast", version: 3, owner: "Ana" });
    expect(JSON.parse(row("Fast")?.json ?? "")).toEqual({ name: "Fast", speed: 2 });
    expect(existsSync(join(dataDir, "presets", LIB, "default", "process", "Fast.json"))).toBe(true);

    expect((await restore({ version: 1 })).json()).toMatchObject({ version: 4 });
    expect(JSON.parse(row("Fast")?.json ?? "")).toEqual({ name: "Fast", speed: 1 });
    expect((await restore({ version: 99 })).statusCode).toBe(404);
  });
});
