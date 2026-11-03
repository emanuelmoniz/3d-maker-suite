// What a release has to survive, across features (5.2.0 Step 14). CI runs it on rows the test makes;
// `REAL_DB=/path/app.sqlite pnpm vitest run apps/server/src/release.test.ts` on a copy of real data.
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bambuStudioAdapter } from "@3d-maker-suite/adapter-bambu";
import { fixture, type MockState, mockAdapter } from "@3d-maker-suite/adapter-mock";
import {
  BUILT_IN_ROLE_IDS,
  BULK_ITEMS,
  type BulkKind,
  type BulkResult,
  type ImportPreview,
  type IntegrationAdapter,
} from "@3d-maker-suite/core";
import { openDb } from "@3d-maker-suite/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.ts";
import { applyPendingRestore } from "./backup/backup.ts";
import { modelIdFor } from "./lib/catalog.ts";
import {
  blockNetwork,
  copyDb,
  emailOf,
  everyModule,
  PW,
  REAL_DB,
  signedIn,
  sterilize,
} from "./testRealDb.ts";
import { seedOneOfEach } from "./testSeed.ts";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => {
      throw new Error("mail in a test");
    },
  },
}));

// Real data has hundreds of rows per list, and a real slicer run takes its time.
if (REAL_DB) vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

/** This machine's Bambu Studio, used only with real data: its presets differ per machine. */
const STUDIO = "C:\\Program Files\\Bambu Studio\\bambu-studio.exe";
const STUDIO_PRESETS = join(process.env.APPDATA ?? "", "BambuStudio", "system");
const FIXTURE = join(import.meta.dirname, "../../../packages/3mf/fixtures/multi_color.3mf");
/** Refused on purpose while an accessory is on a printer (ADR-0018). */
const ARCHIVE_REFUSALS = ["printer_has_accessories", "accessory_installed"];

const KINDS = Object.keys(BULK_ITEMS) as BulkKind[];

/**
 * The vendor under its real id when real rows come from it, so they match. The fake never calls out;
 * its answers are the state the test sets. Bambu Studio's presets are read from this machine's disk.
 */
const adapters = (state: MockState): IntegrationAdapter[] => [
  { ...mockAdapter(state), id: REAL_DB ? "bambu-cloud" : "mock" },
  ...(REAL_DB ? [bambuStudioAdapter()] : []),
];

let dir: string;
/** The upgraded database everything starts from; each test gets its own copy. */
let base: string;

beforeAll(async () => {
  blockNetwork();
  dir = mkdtempSync(join(tmpdir(), "release-"));
  base = join(dir, "base.sqlite");
  if (REAL_DB) copyDb(REAL_DB, base);
  const db = openDb(base);
  if (REAL_DB) sterilize(db, join(dir, "roots"));
  else {
    const data = join(dir, "seed-data");
    mkdirSync(data);
    const app = await buildApp(db, false, data);
    await seedOneOfEach(app, db);
    await app.close();
  }
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
  db.$client.close();
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

let n = 0;
let run: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let vendor: MockState;
let admin: string;
let manager: string;
let writer: string;

beforeEach(async () => {
  run = join(dir, `run-${++n}`);
  mkdirSync(run);
  copyDb(base, join(run, "app.sqlite"));
  db = openDb(join(run, "app.sqlite"));
  vendor = fixture();
  app = await buildApp(db, false, run, { adapters: adapters(vendor) });
  admin = (await signedIn(db, app, "admin", {}, BUILT_IN_ROLE_IDS.admin)).cookie;
  manager = (await signedIn(db, app, "manager", everyModule("manage"))).cookie;
  writer = (await signedIn(db, app, "writer", everyModule("write"))).cookie;
});
afterEach(async () => {
  await app.close();
  db.$client.close();
});

type Row = { id: string; archivedAt?: string | null; rootId?: string | null };
const list = async (kind: BulkKind, archived = "false", cookie = admin) => {
  const rows: Row[] = [];
  for (let page = 1; ; page++) {
    const res = await app.inject({
      url: `${BULK_ITEMS[kind].path}?pageSize=100&page=${page}&archived=${archived}`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { items, total } = res.json();
    rows.push(...items);
    if (rows.length >= total || !items.length) return rows;
  }
};
const ids = (rows: Row[]) => rows.map((r) => r.id).sort();
const bulk = (kind: BulkKind, action: string, rowIds: string[], cookie: string) =>
  app.inject({
    method: "POST",
    url: `/api/bulk/${kind}`,
    payload: { action, ids: rowIds },
    headers: { cookie },
  });
const bulkOk = async (kind: BulkKind, action: string, rowIds: string[], cookie: string) => {
  const res = await bulk(kind, action, rowIds, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as BulkResult;
};
/** Every number archive must not move: stats, and each spool's weight. */
const numbers = async () => ({
  stats: JSON.parse(
    (await app.inject({ url: "/api/stats", headers: { cookie: admin } })).body,
    (k, v) => (k === "archivedAt" ? undefined : v),
  ),
  spools: db.$client.prepare("SELECT id, remaining_grams g FROM spools ORDER BY id").all(),
  usages: db.$client.prepare("SELECT count(*) n, sum(grams) g FROM print_filament_usages").get(),
});
const orphans = () => db.$client.pragma("foreign_key_check");

describe.each(KINDS)("%s", (kind) => {
  it("write is refused bulk; manage archives and restores; nothing moves", async () => {
    const rows = await list(kind);
    if (!REAL_DB) expect(rows.length).toBeGreaterThan(0);
    if (!rows.length) return;
    const rowIds = ids(rows);
    const before = await numbers();

    for (const action of ["archive", "restore", "delete"])
      expect((await bulk(kind, action, rowIds, writer)).statusCode).toBe(403);
    expect(ids(await list(kind))).toEqual(rowIds);

    const archived = await bulkOk(kind, "archive", rowIds, manager);
    expect([...archived.done, ...archived.blocked.map((b) => b.id)].sort()).toEqual(rowIds);
    const refused = archived.blocked.filter((b) => !ARCHIVE_REFUSALS.includes(b.code));
    expect(refused, "archive refused").toEqual([]);
    expect(ids(await list(kind))).toEqual(archived.blocked.map((b) => b.id).sort());
    expect(ids(await list(kind, "true"))).toEqual(expect.arrayContaining(archived.done));
    expect(await numbers()).toEqual(before);

    if (archived.done.length) {
      const back = await bulkOk(kind, "restore", archived.done, manager);
      expect(back.blocked, "restore refused").toEqual([]);
    }
    expect(ids(await list(kind))).toEqual(rowIds);
    expect(await numbers()).toEqual(before);
    // Nothing but the stamps changed on the rows themselves.
    const plain = (rows: Row[]) =>
      JSON.parse(JSON.stringify(rows), (k, v) =>
        k === "updatedAt" || k === "archivedAt" ? undefined : v,
      );
    const sorted = (rows: Row[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    expect(plain(sorted(await list(kind)))).toEqual(plain(sorted(rows)));
    expect(orphans()).toEqual([]);
  });

  it("one row by itself: the same for an admin, and the module's rule for a write user", async () => {
    const [row] = await list(kind);
    if (!row) return;
    const url = `${BULK_ITEMS[kind].path}/${row.id}`;
    const patch = (archived: boolean, cookie: string) =>
      app.inject({ method: "PATCH", url, payload: { archived }, headers: { cookie } });

    const asAdmin = await patch(true, admin);
    if (ARCHIVE_REFUSALS.includes(asAdmin.json().error?.code)) return;
    expect(asAdmin.statusCode, asAdmin.body).toBe(200);
    expect(asAdmin.json().archivedAt).toBeTruthy();
    const opened = await app.inject({ url, headers: { cookie: admin } });
    expect(opened.statusCode, opened.body).toBe(200);
    expect((await patch(false, admin)).json().archivedAt).toBeNull();

    const needsManage =
      /^(printers|accessories|brands|printer-models|machine-profiles|print-profiles|maintenance-types|filament-brands|filament-materials|filament-profiles)$/;
    const asWriter = await patch(true, writer);
    expect(asWriter.statusCode, asWriter.body).toBe(needsManage.test(kind) ? 403 : 200);

    // Delete, one row, each level. Bulk is the same request, so a manager's answers count for it.
    await patch(false, admin);
    const del = (cookie: string) => app.inject({ method: "DELETE", url, headers: { cookie } });
    if (needsManage.test(kind)) expect((await del(writer)).statusCode).toBe(403);
    const asManager = await del(manager);
    expect([204, 409], `${asManager.statusCode} ${asManager.body}`).toContain(asManager.statusCode);
    if (asManager.statusCode === 409) expect(asManager.json().error.code).toBe("in_use");
    else expect((await app.inject({ url, headers: { cookie: admin } })).statusCode).toBe(404);
    expect(orphans()).toEqual([]);
  });
});

describe("delete", () => {
  it("everything goes that nothing uses, whatever the order; the rest says why", async () => {
    const counts = await Promise.all(KINDS.map(async (k) => (await list(k, "all")).length));
    const blocked = new Map<string, BulkResult["blocked"][number]>();
    let done = 0;
    let progress = true;
    while (progress) {
      progress = false;
      blocked.clear();
      for (const kind of KINDS) {
        const rows = ids(await list(kind, "all"));
        if (!rows.length) continue;
        const res = await bulkOk(kind, "delete", rows, admin);
        if (res.done.length) progress = true;
        done += res.done.length;
        for (const b of res.blocked) {
          blocked.set(`${kind}/${b.id}`, b);
          expect(b.code, `${kind}: ${b.message}`).toBe("in_use");
          expect(b.details?.dependents.length, `${kind}: ${b.message}`).toBeGreaterThan(0);
        }
        expect(orphans(), `after deleting ${kind}`).toEqual([]);
      }
    }
    // What's left is held by maintenance history, which stays (ADR-0018), or by what it holds.
    const stuck = [...blocked.values()];
    const holders = new Set(stuck.flatMap((b) => b.details?.dependents.map((d) => d.type)));
    for (const type of holders)
      expect([
        "maintenanceTask",
        "maintenanceType",
        "printer",
        "printerModel",
        "accessory",
      ]).toContain(type);
    const history = db.$client.prepare("SELECT count(*) n FROM maintenance_tasks").get() as {
      n: number;
    };
    if (!history.n) expect(stuck).toEqual([]);
    expect(done + stuck.length).toBe(counts.reduce((a, b) => a + b, 0));
    for (const kind of KINDS)
      expect((await list(kind, "all")).length).toBe(
        [...blocked.keys()].filter((k) => k.startsWith(`${kind}/`)).length,
      );
  });
});

const send = (method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie: admin } });
const get = async (url: string) => {
  const res = await app.inject({ url, headers: { cookie: admin } });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return res.json();
};

/** The vendor's integration, answering with what the data already holds (a real run's). */
const vendorIntegration = async () => {
  if (!REAL_DB) {
    const made = await send("POST", "/api/integrations", {
      adapterId: "mock",
      secrets: { token: "t" },
    });
    return made.json().id as string;
  }
  const sql = (q: string) => db.$client.prepare(q).all() as Record<string, string>[];
  const id = sql("SELECT id FROM integrations WHERE adapter_id = 'bambu-cloud'")[0]?.id ?? "";
  vendor.printers = sql("SELECT external_id, name FROM printers WHERE external_id IS NOT NULL").map(
    (p) => ({
      externalId: p.external_id ?? "",
      name: p.name ?? "",
      brand: "Bambu Lab",
      model: "A1",
    }),
  );
  vendor.prints = [];
  // Its secrets are locked with the real key, which the test doesn't have.
  await send("PATCH", `/api/integrations/${id}`, { secrets: { token: "t" } });
  return id;
};
const sync = async (id: string, type: string) => {
  const res = await send("POST", `/api/integrations/${id}/sync`, { type });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};

describe("an integration failing, then syncing again", () => {
  it("raises one alert per streak; the list clears when it works again", async () => {
    const id = await vendorIntegration();
    const open = async () =>
      (await get("/api/alerts")).filter(
        (a: { kind: string; context: { integrationId?: string } }) =>
          a.kind === "sync_error" && a.context.integrationId === id,
      );
    vendor.fail = "auth_expired";
    expect(await sync(id, "printers")).toMatchObject({
      status: "error",
      errorCode: "auth_expired",
    });
    await sync(id, "printers");
    expect(await open()).toHaveLength(1);

    vendor.fail = undefined;
    expect(await sync(id, "printers")).toMatchObject({ status: "ok" });
    expect(await open()).toHaveLength(0);
    expect((await get(`/api/integrations/${id}`)).status).not.toBe("error");
  });
});

describe("a database moved without its secret.key", () => {
  it("asks to sign in again: nothing else breaks, and a new token saves", async () => {
    const id = await vendorIntegration();
    await send("PUT", "/api/alerts/channels/ntfy", {
      enabled: true,
      config: { server: "https://ntfy.example", topic: "t" },
      secrets: { token: "old" },
    });
    await app.close();
    writeFileSync(join(run, "secret.key"), randomBytes(32));
    app = await buildApp(db, false, run, { adapters: adapters(vendor) });

    expect(await sync(id, "printers")).toMatchObject({ errorCode: "auth_required" });
    expect((await send("POST", "/api/alerts/evaluate")).statusCode).toBeLessThan(300);
    expect(await get("/api/alerts/channels")).toBeDefined();

    const saved = await send("PATCH", `/api/integrations/${id}`, { secrets: { token: "new" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await sync(id, "printers")).toMatchObject({ status: "ok" });
  });
});

describe("a sync after archiving and deleting imported rows", () => {
  it("printers: archived stays archived, deleted stays gone and shows in the review", async () => {
    const id = await vendorIntegration();
    await sync(id, "printers");
    await sync(id, "printers");
    const imported = () =>
      db.$client.prepare("SELECT id FROM printers WHERE external_id IS NOT NULL").all() as {
        id: string;
      }[];
    const printer = imported()[0]?.id;
    expect(printer).toBeDefined();
    const url = `/api/printers/${printer}`;
    // A real printer has an accessory on it and history that holds it: cleared for this one.
    db.$client.prepare("DELETE FROM accessory_installs WHERE printer_id = ?").run(printer);

    expect((await send("PATCH", url, { archived: true })).statusCode).toBe(200);
    expect((await sync(id, "printers")).created).toBe(0);
    expect((await get(url)).archivedAt).toBeTruthy();
    expect(imported()).toHaveLength(1);
    expect((await send("PATCH", url, { archived: false })).statusCode).toBe(200);

    db.$client.prepare("DELETE FROM maintenance_tasks WHERE printer_id = ?").run(printer);
    const prints = db.$client.prepare("SELECT id FROM prints WHERE printer_id = ?").all(printer);
    for (const { id: print } of prints as { id: string }[])
      expect((await send("DELETE", `/api/prints/${print}`)).statusCode).toBe(204);
    const gone = await send("DELETE", url);
    expect(gone.statusCode, gone.body).toBe(204);
    expect(await sync(id, "printers")).toMatchObject({ status: "ok", created: 0 });
    expect(imported()).toEqual([]);

    const opened = await send("POST", `/api/import/integration/${id}/printers`);
    expect((opened.json() as ImportPreview).rows[0]).toMatchObject({
      deleted: true,
      action: "skip",
    });
  });

  const CATALOG: [string, BulkKind][] = [
    ["brands", "brands"],
    ["printerModels", "printer-models"],
    ["machineProfiles", "machine-profiles"],
    ["printProfiles", "print-profiles"],
    ["filamentBrands", "filament-brands"],
    ["filamentMaterials", "filament-materials"],
    ["filamentProfiles", "filament-profiles"],
  ];
  it.skipIf(!REAL_DB || !existsSync(STUDIO_PRESETS)).each(CATALOG)(
    "%s from this machine's Bambu Studio: the same, on real presets",
    async (type, kind) => {
      const made = await send("POST", "/api/integrations", { adapterId: "bambu-studio" });
      expect(made.statusCode, made.body).toBe(201);
      const id = made.json().id;
      const first = await sync(id, type);
      expect(first.status, JSON.stringify(first)).toBe("ok");
      await sync(id, type);
      const active = ids(await list(kind));
      const everything = ids(await list(kind, "all"));
      expect(active.length).toBeGreaterThan(0);

      // One archived; one deleted, the first nothing uses.
      const res = await bulkOk(kind, "archive", active.slice(0, 1), admin);
      expect(res.done).toHaveLength(1);
      let deleted: string | undefined;
      for (const row of active.slice(1)) {
        if ((await bulkOk(kind, "delete", [row], admin)).done.length) {
          deleted = row;
          break;
        }
      }

      const after = await sync(id, type);
      expect(after.status, JSON.stringify(after)).toBe("ok");
      expect(after.created, "a run brought a row back").toBe(0);
      expect(ids(await list(kind, "all"))).toEqual(everything.filter((r) => r !== deleted));
      expect(ids(await list(kind, "true"))).toContain(res.done[0]);
      expect(orphans()).toEqual([]);
    },
  );
});

describe("moving a NAS install to a VPS", () => {
  /** Every file below `base`, with size and mtime: any write shows. */
  const disk = (base: string) =>
    (readdirSync(base, { recursive: true }) as string[])
      .map((f) => {
        const s = statSync(join(base, f));
        return `${f} ${s.isDirectory() ? "dir" : `${s.size} ${s.mtimeMs}`}`;
      })
      .sort();

  it("backup, move the files, restore, change the root: projects open and slice", async () => {
    // The NAS: a root with one project with a real 3MF, and whatever else the data holds.
    const nas = join(run, "nas", "projects");
    mkdirSync(join(nas, "Benchy"), { recursive: true });
    copyFileSync(FIXTURE, join(nas, "Benchy", "benchy.3mf"));
    const [old] = (await get("/api/roots")) as { id: string }[];
    if (old) db.$client.prepare("UPDATE roots SET path = ? WHERE id = ?").run(nas, old.id);
    else expect((await send("POST", "/api/roots", { path: nas })).statusCode).toBe(201);
    const benchy = await send("POST", "/api/projects", {
      name: "Benchy",
      folderPath: join(nas, "Benchy"),
    });
    expect(benchy.statusCode, benchy.body).toBe(201);
    const benchyId: string = benchy.json().id;
    // The printer the 3MF is for, so the plate needs no other printer's preset.
    const a1 = await send("POST", "/api/printers", {
      name: "Release A1",
      modelId: modelIdFor(db, "Bambu Lab", "A1"),
    });
    expect(a1.statusCode, a1.body).toBe(201);
    // Real projects keep their folders, so they have files to come back to.
    const real = db.$client
      .prepare(
        "SELECT id, folder, file_path FROM projects WHERE file_path IS NOT NULL AND id != ? LIMIT 5",
      )
      .all(benchyId) as { id: string; folder: string; file_path: string }[];
    for (const p of real) {
      mkdirSync(dirname(join(nas, p.folder, p.file_path)), { recursive: true });
      writeFileSync(join(nas, p.folder, p.file_path), "file");
    }
    // Files the database points at, and a secret that only the backup's key opens.
    mkdirSync(join(run, "photos"), { recursive: true });
    writeFileSync(join(run, "photos", "printer.png"), "img");
    const secret = await send("POST", "/api/integrations", {
      adapterId: REAL_DB ? "bambu-cloud" : "mock",
      secrets: { token: "t" },
    });
    expect(secret.statusCode, secret.body).toBe(201);
    const before = await numbers();
    const projects = ids(await list("projects", "all"));

    const made = await send("POST", "/api/backups");
    expect(made.statusCode, made.body).toBe(201);
    const zip = (
      await app.inject({ url: `/api/backups/${made.json().name}`, headers: { cookie: admin } })
    ).rawPayload;

    // The files move by hand; the NAS is gone.
    const vps = join(run, "vps", "projects");
    cpSync(nas, vps, { recursive: true });
    rmSync(join(run, "nas"), { recursive: true });
    await app.close();
    db.$client.close();

    // A fresh install: no users yet, so the restore needs no sign-in. Then the restart main.ts does.
    const data = join(run, "vps", "data");
    mkdirSync(data, { recursive: true });
    db = openDb(join(data, "app.sqlite"));
    app = await buildApp(db, false, data, { adapters: adapters(vendor) });
    const up = await app.inject({
      method: "POST",
      url: "/api/backups/upload",
      headers: { "content-type": "application/zip" },
      payload: zip,
    });
    expect(up.statusCode, up.body).toBe(201);
    const restored = await app.inject({
      method: "POST",
      url: `/api/backups/${up.json().name}/restore`,
      payload: { confirm: true },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    await app.close();
    db.$client.close();
    expect(applyPendingRestore(data)).toBe(true);
    db = openDb(join(data, "app.sqlite"));
    app = await buildApp(db, false, data, { adapters: adapters(vendor) });

    // Same people, same numbers, same files; the secret still opens.
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: emailOf("admin"), password: PW },
    });
    expect(login.statusCode, login.body).toBe(200);
    admin = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    expect(await numbers()).toEqual(before);
    expect(existsSync(join(data, "photos", "printer.png"))).toBe(true);
    const test = await send("POST", `/api/integrations/${secret.json().id}/test`);
    expect(test.json(), test.body).toMatchObject({ ok: true });

    // The old root is gone: projects read missing and none is lost to a scan.
    expect(ids(await list("projects", "all"))).toEqual(projects);
    expect((await get(`/api/projects/${benchyId}`)).folderState).not.toBe("ok");
    const idle = async () => {
      while ((await get("/api/projects/scan")).state !== "idle")
        await new Promise((r) => setTimeout(r, 20));
    };
    await send("POST", "/api/projects/scan");
    await idle();
    expect(ids(await list("projects", "all"))).toEqual(projects);

    // Bulk change root: nothing on disk moves.
    const root = await send("POST", "/api/roots", { path: vps });
    expect(root.statusCode, root.body).toBe(201);
    const files = disk(vps);
    const linked = (await list("projects", "all")).filter((p) => p.rootId);
    const relink = await send("POST", "/api/projects/relink", {
      ids: linked.map((p) => p.id),
      rootId: root.json().id,
    });
    expect(relink.statusCode, relink.body).toBe(200);
    expect(relink.json().skipped).toEqual([]);
    await idle();
    expect(disk(vps)).toEqual(files);
    expect(ids(await list("projects", "all"))).toEqual(projects);

    // They open: the folder is there, with its files.
    for (const id of [benchyId, ...real.map((p) => p.id)])
      expect((await get(`/api/projects/${id}`)).folderState, id).toBe("ok");
    expect(JSON.stringify(await get(`/api/projects/${benchyId}/files`))).toContain("benchy.3mf");

    // And slice, with a fake slicer here and in CI, and the real one when it's on this machine.
    const slice = async (slicerIntegrationId: string) => {
      const plates = [
        {
          file: "benchy.3mf",
          plate: 1,
          printerId: a1.json().id,
          printProfileId: null,
          filaments: [],
          slicerIntegrationId,
        },
      ];
      const put = await send("PUT", `/api/projects/${benchyId}/slicing`, { plates });
      expect(put.statusCode, put.body).toBe(200);
      const started = await send("POST", `/api/projects/${benchyId}/slicing/run`);
      expect(started.statusCode, started.body).toBe(202);
      for (let i = 0; i < 12_000; i++) {
        const s = await get(`/api/projects/${benchyId}/slicing`);
        if (!s.plates.some((p: { job: unknown }) => p.job)) return s.plates[0];
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error("slicing never finished");
    };
    const slicerId: string = secret.json().id;
    await send("PATCH", `/api/integrations/${slicerId}`, { slicerPath: process.execPath });
    expect(await slice(slicerId)).toMatchObject({ needsSlicing: false });
    expect(vendor.sliced?.[0]?.file).toContain(join("vps", "projects", "Benchy"));

    if (REAL_DB && existsSync(STUDIO)) {
      const studio = await send("POST", "/api/integrations", { adapterId: "bambu-studio" });
      await send("PATCH", `/api/integrations/${studio.json().id}`, { slicerPath: STUDIO });
      const plate = await slice(studio.json().id);
      expect(plate, JSON.stringify(plate)).toMatchObject({ needsSlicing: false, error: null });
      expect(plate.result.printTimeSeconds, JSON.stringify(plate)).toBeGreaterThan(0);
      expect(plate.result.weightGrams, JSON.stringify(plate)).toBeGreaterThan(0);
    }
    expect(orphans()).toEqual([]);
  });
});

describe("what a delete clears", () => {
  /** The column as a database has it that ran the migration before its FK got `set null`. */
  const withoutFkAction = (table: string, column: string, target: string) => {
    db.$client.exec(
      `ALTER TABLE ${table} RENAME COLUMN ${column} TO ${column}_was;
       ALTER TABLE ${table} ADD ${column} text REFERENCES ${target}(id);
       UPDATE ${table} SET ${column} = ${column}_was, ${column}_was = NULL;`,
    );
  };

  it("a printer with plates, on a database whose FK doesn't clear them", async () => {
    const project = db.$client.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
    const printer = await send("POST", "/api/printers", {
      name: "Plate printer",
      modelId: modelIdFor(db, "Bambu Lab", "A1"),
    });
    const printerId: string = printer.json().id;
    db.$client
      .prepare(
        "INSERT INTO project_slice_plates (id, project_id, file, plate, printer_id, file_size, file_mtime_ms, file_sha256, created_at, updated_at) VALUES ('plate-1', ?, 'x.3mf', 1, ?, 1, 1, 'x', 'now', 'now')",
      )
      .run(project.id, printerId);
    withoutFkAction("project_slice_plates", "printer_id", "printers");
    const gone = await send("DELETE", `/api/printers/${printerId}`);
    expect(gone.statusCode, gone.body).toBe(204);
    expect(
      db.$client
        .prepare("SELECT printer_id p FROM project_slice_plates WHERE id = 'plate-1'")
        .get(),
    ).toEqual({ p: null });
  });

  it("a user who owns projects, on a database whose FK doesn't clear them", async () => {
    const owner = await signedIn(db, app, "owner", {});
    const project = db.$client.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
    db.$client
      .prepare("UPDATE projects SET owner_id = ? WHERE id = ?")
      .run(owner.user.id, project.id);
    withoutFkAction("projects", "owner_id", "users");
    const gone = await send("DELETE", `/api/users/${owner.user.id}`);
    expect(gone.statusCode, gone.body).toBe(204);
    expect(
      db.$client.prepare("SELECT owner_id o FROM projects WHERE id = ?").get(project.id),
    ).toEqual({ o: null });
  });
});

describe("files the database points at, gone from the disk", () => {
  it("are a 404, not a server error; the rows still open", async () => {
    const printer = await send("POST", "/api/printers", {
      name: "No photo",
      modelId: modelIdFor(db, "Bambu Lab", "A1"),
    });
    const printerId: string = printer.json().id;
    db.$client
      .prepare("UPDATE printers SET photo_path = 'photos/gone.png' WHERE id = ?")
      .run(printerId);
    const project = db.$client.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
    db.$client
      .prepare("UPDATE projects SET thumbnail_path = 'thumbnails/gone.png' WHERE id = ?")
      .run(project.id);
    for (const url of [
      `/api/printers/${printerId}/photo`,
      `/api/projects/${project.id}/thumbnail`,
    ]) {
      const res = await app.inject({ url, headers: { cookie: admin } });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(404);
    }
    await get(`/api/printers/${printerId}`);
    await get(`/api/projects/${project.id}`);
  });
});

describe.runIf(REAL_DB)("upgrading the real 5.1.0 database", () => {
  it("keeps every row of every table, with every value", () => {
    const old = join(dir, "untouched.sqlite");
    const up = join(dir, "upgraded.sqlite");
    copyDb(REAL_DB ?? "", old);
    copyDb(REAL_DB ?? "", up);
    const fresh = openDb(up);
    const q = fresh.$client;
    q.prepare("ATTACH DATABASE ? AS old").run(old);
    const tables = q
      .prepare(
        "SELECT name FROM old.sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '__*'",
      )
      .all() as { name: string }[];
    expect(tables.length).toBeGreaterThan(30);
    for (const { name } of tables) {
      const columns = q.prepare(`SELECT name FROM pragma_table_info('${name}', 'old')`).all() as {
        name: string;
      }[];
      const cols = columns.map((c) => `"${c.name}"`).join(",");
      const count = (where: string) =>
        (q.prepare(`SELECT count(*) n FROM ${where}."${name}"`).get() as { n: number }).n;
      expect(count("main"), name).toBe(count("old"));
      const changed = q.prepare(
        `SELECT ${cols} FROM old."${name}" EXCEPT SELECT ${cols} FROM main."${name}"`,
      );
      expect(changed.all().length, name).toBe(0);
    }
    // The new columns start empty, and it all holds together.
    const added = [
      "brands",
      "clients",
      "filament_brands",
      "filament_materials",
      "orders",
      "printer_models",
      "prints",
      "quotes",
    ];
    for (const t of added)
      expect(
        q.prepare(`SELECT count(*) n FROM "${t}" WHERE archived_at IS NOT NULL`).get(),
      ).toEqual({ n: 0 });
    expect(q.pragma("foreign_key_check")).toEqual([]);
    expect(q.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    q.close();
  });
});
