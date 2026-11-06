import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BULK_ITEMS, inUseDetailsSchema } from "@3d-maker-suite/core";
import { openDb, schema } from "@3d-maker-suite/db";
import { and, eq, getTableName } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { Rights } from "./lib/auth.ts";
import { dependentsOf, ITEMS } from "./lib/dependents.ts";
import { readPreferences } from "./lib/preferences.ts";
import { insertProfile } from "./testSeed.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

const send = (method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload });
const made = async (url: string, payload: object): Promise<string> => {
  const res = await send("POST", url, payload);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};
const startedAt = "2026-01-01T10:00:00.000Z";
const quoteBody = {
  name: "Vase",
  form: {},
  cost: { material: 1, energy: 1, wear: 0, maintenance: 0, total: 2, unpricedGrams: 0 },
  quote: {
    unitCost: 2,
    labor: 0,
    failureMargin: 0,
    subtotal: 2,
    markup: 0,
    unitPrice: 2,
    quantity: 1,
    total: 2,
  },
};

let n = 0;
const unique = (name: string) => `${name} ${++n}`;
const brand = () => made("/api/brands", { name: unique("Brand") });
const model = async (brandId?: string) =>
  made("/api/printer-models", { brandId: brandId ?? (await brand()), model: unique("X") });
const machine = async (printerModelId?: string) =>
  insertProfile(db, "machineProfiles", {
    name: unique("Machine"),
    printerModelId: printerModelId ?? (await model()),
  }).id;
const printProfile = async (printerModelId?: string) =>
  insertProfile(db, "printProfiles", { name: unique("Fine"), printerModelId }).id;
const printer = async (modelId?: string) =>
  made("/api/printers", {
    name: unique("P"),
    modelId: modelId ?? (await model()),
    state: "working",
  });
const accessory = () =>
  made("/api/accessories", { name: unique("AMS"), type: "AMS", state: "working" });
const maintenanceType = (fields: object = {}) =>
  made("/api/maintenance/types", { name: unique("Oil"), ...fields });
const filamentBrand = () => made("/api/filament-brands", { name: unique("FB") });
const material = () => made("/api/filament-materials", { name: unique("PLA") });
const profile = async (fields: object = {}) =>
  insertProfile(db, "filamentProfiles", {
    materialId: await material(),
    densityGcm3: 1.24,
    name: unique("Basic"),
    ...fields,
  }).id;
const spool = async (fields: object = {}) =>
  made("/api/filament/spools", {
    materialId: await material(),
    name: unique("Basic"),
    initialGrams: 1000,
    ...fields,
  });
const project = () => made("/api/projects", { name: unique("Vase") });
const client = () => made("/api/clients", { name: unique("Ana"), mobile: unique("911") });
const quote = (fields: object = {}) =>
  made("/api/costs/quotes", { ...quoteBody, name: unique("Quote"), ...fields });
const order = async (fields: object = {}) =>
  made("/api/orders", { projectIds: [await project()], price: 5, ...fields });
const print = async (fields: object = {}) =>
  made("/api/prints", {
    printerId: await printer(),
    title: unique("Body"),
    startedAt,
    durationSec: 60,
    outcome: "success",
    ...fields,
  });
const task = async (typeFields: object, target: object) => {
  const typeId = await maintenanceType(typeFields);
  return made("/api/maintenance/tasks", { typeId, ...target });
};
const install = (accessoryId: string, printerId: string) =>
  made(`/api/accessories/${accessoryId}/installs`, { printerId, installedAt: startedAt });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "deletes-"));
  db = openDb(":memory:");
  app = await buildApp(db, false, dir);
});

afterEach(async () => {
  await app.close();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const urls = {
  brands: "/api/brands",
  printerModels: "/api/printer-models",
  machineProfiles: "/api/machine-profiles",
  printProfiles: "/api/print-profiles",
  printers: "/api/printers",
  accessories: "/api/accessories",
  maintenanceTypes: "/api/maintenance/types",
  filamentBrands: "/api/filament-brands",
  filamentMaterials: "/api/filament-materials",
  filamentProfiles: "/api/filament/profiles",
  spools: "/api/filament/spools",
  projects: "/api/projects",
  prints: "/api/prints",
  orders: "/api/orders",
  quotes: "/api/costs/quotes",
  clients: "/api/clients",
};
const fresh: Record<keyof typeof urls, () => Promise<string>> = {
  brands: brand,
  printerModels: () => model(),
  machineProfiles: () => machine(),
  printProfiles: () => printProfile(),
  printers: () => printer(),
  accessories: accessory,
  maintenanceTypes: () => maintenanceType(),
  filamentBrands: filamentBrand,
  filamentMaterials: material,
  filamentProfiles: () => profile(),
  spools: () => spool(),
  projects: project,
  prints: () => print(),
  orders: () => order(),
  quotes: () => quote(),
  clients: client,
};

const del = (kind: keyof typeof urls, id: string) => send("DELETE", `${urls[kind]}/${id}`);

describe("delete", () => {
  it.each(Object.keys(urls) as (keyof typeof urls)[])("%s: a free one goes", async (kind) => {
    const id = await fresh[kind]();
    const res = await del(kind, id);
    expect(res.statusCode, res.body).toBe(204);
    expect((await app.inject(`${urls[kind]}/${id}`)).statusCode).toBe(404);
    expect((await del(kind, id)).statusCode).toBe(404);
  });

  /** Item, what uses it, the dependent's URL when it can be archived, and how to add one. */
  const blocks: [
    keyof typeof urls,
    string,
    string | null,
    (id: string) => Promise<string>,
    RegExp,
  ][] = [
    ["brands", "printerModel", urls.printerModels, (id) => model(id), /X/],
    ["printerModels", "printer", urls.printers, (id) => printer(id), /^\d\d-P/],
    ["printerModels", "machineProfile", urls.machineProfiles, (id) => machine(id), /Machine/],
    ["printerModels", "printProfile", urls.printProfiles, (id) => printProfile(id), /Fine/],
    [
      "printerModels",
      "maintenanceType",
      urls.maintenanceTypes,
      (id) => maintenanceType({ appliesToModelIds: [id] }),
      /Oil/,
    ],
    [
      "machineProfiles",
      "print",
      urls.prints,
      async (id) => print({ machineProfileId: id }),
      /^\d{4}-Body/,
    ],
    ["printers", "print", urls.prints, (id) => print({ printerId: id }), /Body/],
    ["printers", "maintenanceTask", null, (id) => task({}, { printerId: id }), /Oil/],
    [
      "printers",
      "accessory",
      urls.accessories,
      async (id) => {
        const a = await accessory();
        await install(a, id);
        const [row] = db.select().from(schema.accessoryInstalls).all();
        await send("PATCH", `/api/accessories/${a}/installs/${row?.id}`, { removedAt: startedAt });
        return a;
      },
      /^\d\d-AMS/,
    ],
    [
      "printers",
      "maintenanceType",
      urls.maintenanceTypes,
      (id) => maintenanceType({ appliesToPrinterIds: [id] }),
      /Oil/,
    ],
    [
      "accessories",
      "maintenanceTask",
      null,
      (id) => task({ target: "accessory" }, { accessoryId: id }),
      /Oil/,
    ],
    [
      "accessories",
      "printer",
      urls.printers,
      async (id) => {
        const p = await printer();
        await install(id, p);
        const [row] = db.select().from(schema.accessoryInstalls).all();
        await send("PATCH", `/api/accessories/${id}/installs/${row?.id}`, { removedAt: startedAt });
        return p;
      },
      /^\d\d-P/,
    ],
    [
      "accessories",
      "maintenanceType",
      urls.maintenanceTypes,
      (id) => maintenanceType({ target: "accessory", appliesToAccessoryIds: [id] }),
      /Oil/,
    ],
    [
      "maintenanceTypes",
      "maintenanceTask",
      null,
      async (id) => made("/api/maintenance/tasks", { typeId: id, printerId: await printer() }),
      /Oil/,
    ],
    [
      "filamentBrands",
      "filamentProfile",
      urls.filamentProfiles,
      (id) => profile({ brandId: id }),
      /Basic/,
    ],
    [
      "filamentMaterials",
      "filamentProfile",
      urls.filamentProfiles,
      (id) => profile({ materialId: id }),
      /Basic/,
    ],
    ["filamentBrands", "spool", urls.spools, (id) => spool({ brandId: id }), /^\d{3}-.*Basic/],
    [
      "filamentMaterials",
      "spool",
      urls.spools,
      (id) => spool({ materialId: id }),
      /^\d{3}-.*Basic/,
    ],
    [
      "spools",
      "print",
      urls.prints,
      (id) => print({ usages: [{ spoolId: id, grams: 5 }] }),
      /Body/,
    ],
    ["projects", "print", urls.prints, (id) => print({ projectId: id }), /Body/],
    ["projects", "order", urls.orders, (id) => order({ projectIds: [id] }), /^\d{3}$/],
    ["projects", "quote", urls.quotes, (id) => quote({ projectId: id }), /Quote/],
    [
      "orders",
      "print",
      urls.prints,
      async (id) => {
        const { projectIds } = (await app.inject(`/api/orders/${id}`)).json();
        return print({ orderId: id, projectId: projectIds[0] });
      },
      /Body/,
    ],
    ["quotes", "order", urls.orders, (id) => order({ quoteId: id }), /^\d{3}$/],
    ["clients", "order", urls.orders, (id) => order({ clientId: id }), /^\d{3}$/],
    ["clients", "quote", urls.quotes, (id) => quote({ clientId: id }), /Quote/],
  ];

  it.each(blocks)(
    "%s: %s blocks it and is named, archived too",
    async (kind, type, url, add, label) => {
      const id = await fresh[kind]();
      const dependent = await add(id);
      const blocked = async () => {
        const res = await del(kind, id);
        expect(res.statusCode, res.body).toBe(409);
        const { code, details } = res.json().error;
        expect(code).toBe("in_use");
        return inUseDetailsSchema.parse(details).dependents.find((d) => d.type === type);
      };
      const active = await blocked();
      expect(active).toMatchObject({ total: 1, archived: 0 });
      expect(active?.items).toMatchObject([{ id: dependent, archived: false }]);
      expect(active?.items[0]?.label).toMatch(label);
      expect((await app.inject(`${urls[kind]}/${id}`)).statusCode).toBe(200);

      if (!url) return;
      expect((await send("PATCH", `${url}/${dependent}`, { archived: true })).statusCode).toBe(200);
      const archived = await blocked();
      expect(archived).toMatchObject({ total: 1, archived: 1 });
      expect(archived?.items).toMatchObject([{ id: dependent, archived: true }]);
    },
  );

  it("lists at most 20 per type, active ones first, and counts them all", async () => {
    const printerId = await printer();
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push(await print({ printerId }));
    await send("PATCH", `/api/prints/${ids[0]}`, { archived: true });
    const [uses] = dependentsOf(db, undefined, "printers", printerId);
    expect(uses).toMatchObject({ type: "print", total: 22, archived: 1 });
    expect(uses?.items).toHaveLength(20);
    expect(uses?.items.every((i) => !i.archived)).toBe(true);
  });

  it("dependents the caller can't read are counted, not named", async () => {
    const projectId = await project();
    await print({ projectId });
    await quote({ projectId });
    const rights = (permissions: object) =>
      ({
        id: "u",
        rights: {
          admin: false,
          permissions,
          projectRights: {},
        },
      }) as unknown as Rights;
    const seen = (permissions: object) =>
      dependentsOf(db, rights(permissions), "projects", projectId).map((d) => [
        d.type,
        d.total,
        d.items.length,
      ]);
    expect(seen({ prints: "read", costs: "none" })).toEqual([
      ["print", 1, 1],
      ["quote", 1, 0],
    ]);
    expect(seen({ prints: "none", costs: "read" })).toEqual([
      ["print", 1, 0],
      ["quote", 1, 1],
    ]);
  });
});

describe("what goes with an item", () => {
  const alert = (task: string) =>
    db
      .insert(schema.alerts)
      .values({
        kind: "slice_failed",
        severity: "error",
        module: "projects",
        task,
        entityType: "test",
        entityId: crypto.randomUUID(),
      })
      .returning()
      .get().id;
  const openAlerts = () =>
    db
      .select()
      .from(schema.alerts)
      .all()
      .filter((a) => !a.resolvedAt)
      .map((a) => a.task);
  const tag = async (entityType: "printer" | "spool" | "project", entityId: string) => {
    const tagId = db
      .insert(schema.tags)
      .values({ name: unique("t"), color: "#000000" })
      .returning()
      .get().id;
    db.insert(schema.taggings).values({ tagId, entityType, entityId }).run();
  };
  const plate = (projectId: string, printerId?: string) =>
    db
      .insert(schema.projectSlicePlates)
      .values({
        projectId,
        printerId,
        file: "a.3mf",
        plate: 1,
        fileSize: 1,
        fileMtimeMs: 1,
        fileSha256: "x",
      })
      .run();
  const integration = () =>
    db.insert(schema.integrations).values({ adapterId: "mock" }).returning().get().id;

  it("printer: comments, tags, snapshot, alerts, photo and default go; a plate only loses it", async () => {
    const id = await printer();
    const projectId = await project();
    await send("POST", `/api/printers/${id}/comments`, { body: "note" });
    await tag("printer", id);
    const integrationId = integration();
    db.update(schema.printers).set({ integrationId, externalId: "ext-1" }).run();
    db.insert(schema.importSnapshots)
      .values({ integrationId, entity: "printers", rowId: id, values: {} })
      .run();
    alert(`printer:${id}`);
    alert(`maintenance:${id}:type`);
    const other = `printer:${crypto.randomUUID()}`;
    alert(other);
    db.insert(schema.settings).values({ key: "defaultPrinterId", value: id }).run();
    plate(projectId, id);
    mkdirSync(join(dir, "photos"), { recursive: true });
    const photo = join(dir, "photos", `${id}.png`);
    writeFileSync(photo, "png");
    db.update(schema.printers)
      .set({ photoPath: `photos/${id}.png` })
      .run();

    expect((await del("printers", id)).statusCode).toBe(204);

    expect(db.select().from(schema.printerComments).all()).toEqual([]);
    expect(db.select().from(schema.taggings).all()).toEqual([]);
    expect(db.select().from(schema.importSnapshots).all()).toEqual([]);
    expect(openAlerts()).toEqual([other]);
    expect(readPreferences(db).defaultPrinterId).toBeNull();
    expect(db.select().from(schema.projectSlicePlates).all()).toMatchObject([{ printerId: null }]);
    expect(existsSync(photo)).toBe(false);
    expect(db.select().from(schema.deletedSources).all()).toMatchObject([
      { entity: "printers", source: `${integrationId}:ext-1` },
    ]);
  });

  it("a printer entered by hand leaves no mark", async () => {
    expect((await del("printers", await printer())).statusCode).toBe(204);
    expect(db.select().from(schema.deletedSources).all()).toEqual([]);
  });

  it("installs on a printer or an accessory block, though the FK would delete them", async () => {
    const p = await printer();
    const a = await accessory();
    await install(a, p);
    expect((await del("accessories", a)).json().error.code).toBe("in_use");
    expect((await del("printers", p)).json().error.code).toBe("in_use");
    expect(db.select().from(schema.accessoryInstalls).all()).toHaveLength(1);
  });

  it("spool: its weight log goes, though the FK restricts", async () => {
    const id = await spool();
    await send("POST", `/api/filament/spools/${id}/adjust`, {
      kind: "correction",
      remainingGrams: 500,
    });
    expect(db.select().from(schema.spoolWeightEntries).all().length).toBeGreaterThan(0);
    await tag("spool", id);
    alert(`spool:${id}`);
    expect((await del("spools", id)).statusCode).toBe(204);
    expect(db.select().from(schema.spoolWeightEntries).all()).toEqual([]);
    expect(db.select().from(schema.taggings).all()).toEqual([]);
    expect(openAlerts()).toEqual([]);
  });

  it("print: the filament returns to its spool", async () => {
    const spoolId = await spool();
    const id = await print({ usages: [{ spoolId, grams: 50 }] });
    const left = async () => (await app.inject(`/api/filament/spools/${spoolId}`)).json();
    expect((await left()).remainingGrams).toBe(950);
    expect((await del("prints", id)).statusCode).toBe(204);
    expect((await left()).remainingGrams).toBe(1000);
    expect(db.select().from(schema.printFilamentUsages).all()).toEqual([]);
  });

  it("order: its project links go, the project stays", async () => {
    const projectId = await project();
    const id = await order({ projectIds: [projectId] });
    expect((await del("orders", id)).statusCode).toBe(204);
    expect(db.select().from(schema.orderProjects).all()).toEqual([]);
    expect((await app.inject(`/api/projects/${projectId}`)).statusCode).toBe(200);
  });

  it("project: tags, plates and alerts go; so does its thumbnail", async () => {
    const id = await project();
    await tag("project", id);
    alert(`project:${id}`);
    plate(id);
    mkdirSync(join(dir, "thumbnails"), { recursive: true });
    const thumb = join(dir, "thumbnails", `${id}.png`);
    writeFileSync(thumb, "png");
    db.update(schema.projects)
      .set({ thumbnailPath: `thumbnails/${id}.png` })
      .run();
    expect((await del("projects", id)).statusCode).toBe(204);
    expect(db.select().from(schema.taggings).all()).toEqual([]);
    expect(db.select().from(schema.projectSlicePlates).all()).toEqual([]);
    expect(openAlerts()).toEqual([]);
    expect(existsSync(thumb)).toBe(false);
  });

  it.each([
    ["brands", "/api/brands", "logo", "brands"],
    ["printerModels", "/api/printer-models", "image", "models"],
    ["filamentBrands", "/api/filament-brands", "logo", "filament-brands"],
  ] as const)("%s: its image file goes", async (kind, url, name, folder) => {
    const id = await fresh[kind]();
    const put = await app.inject({
      method: "PUT",
      url: `${url}/${id}/${name}`,
      headers: { "content-type": "image/png" },
      payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(put.statusCode, put.body).toBe(200);
    const file = join(dir, folder, `${id}.png`);
    expect(existsSync(file)).toBe(true);
    expect((await del(kind, id)).statusCode).toBe(204);
    expect(existsSync(file)).toBe(false);
  });

  it("a device root's folder and a kept folder count as files", async () => {
    const root = db
      .insert(schema.roots)
      .values({ name: "WS", location: crypto.randomUUID(), path: "C:/models", position: 0 })
      .returning()
      .get().id;
    const folderRow = {
      rootId: root,
      folder: "001_Box",
      digest: "d",
      scan: {},
      updatedAt: startedAt,
    };
    db.insert(schema.deviceRootFolders).values(folderRow).run();
    const clear = () =>
      db
        .delete(schema.deviceRootFolders)
        .where(
          and(
            eq(schema.deviceRootFolders.rootId, root),
            eq(schema.deviceRootFolders.folder, "001_Box"),
          ),
        )
        .run();

    // In the device's last index, whether it's online or not.
    const linked = await project();
    db.update(schema.projects)
      .set({ rootId: root, folder: "001_Box" })
      .where(eq(schema.projects.id, linked))
      .run();
    expect((await del("projects", linked)).json().error.code).toBe("folder_has_files");
    clear();
    expect((await del("projects", linked)).statusCode).toBe(204);

    // Unlinked and kept: nothing else keeps it out of the next scan.
    db.insert(schema.deviceRootFolders).values(folderRow).run();
    const kept = await project();
    db.update(schema.projects)
      .set({ unlinkedRootId: root, unlinkedFolder: "001_Box" })
      .where(eq(schema.projects.id, kept))
      .run();
    expect((await del("projects", kept)).json().error.code).toBe("folder_has_files");
    clear();
    expect((await del("projects", kept)).statusCode).toBe(204);
  });

  it("in_use is reported before folder_has_files", async () => {
    const userless = await project();
    await print({ projectId: userless });
    expect((await del("projects", userless)).json().error.code).toBe("in_use");
  });

  it("reopening a quote with stale ids in its form doesn't fail", async () => {
    const printerId = await printer();
    const spoolId = await spool();
    const projectId = await project();
    const form = {
      projectId,
      printerId,
      plates: [{ file: "a.3mf", plate: 1, printerId, filaments: [spoolId], spools: [spoolId] }],
    };
    const id = await quote({ form });
    for (const [kind, ref] of [
      ["printers", printerId],
      ["spools", spoolId],
      ["projects", projectId],
    ] as const)
      expect((await del(kind, ref)).statusCode, kind).toBe(204);

    const url = `/api/costs/quotes/${id}`;
    const opened = await app.inject(url);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().form).toEqual(form);
    const saved = await send("PATCH", url, { name: "Again", form });
    expect(saved.statusCode, saved.body).toBe(200);
  });
});

describe("bulk", () => {
  const bulkKind = Object.fromEntries(Object.entries(BULK_ITEMS).map(([k, i]) => [i.path, k]));

  it("covers every entity", () => {
    expect(Object.keys(bulkKind).sort()).toEqual(Object.values(urls).sort());
  });

  it.each(Object.keys(urls) as (keyof typeof urls)[])(
    "%s: archives, restores and deletes",
    async (kind) => {
      const ids = [await fresh[kind](), await fresh[kind]()];
      const url = `/api/bulk/${bulkKind[urls[kind]]}`;
      const archivedAt = async (id: string) =>
        (await app.inject(`${urls[kind]}/${id}`)).json().archivedAt;
      const run = async (action: string) => {
        const res = await send("POST", url, { action, ids });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json()).toEqual({ done: ids, blocked: [] });
      };

      await run("archive");
      for (const id of ids) expect(await archivedAt(id)).toEqual(expect.any(String));
      await run("restore");
      for (const id of ids) expect(await archivedAt(id)).toBeNull();
      await run("delete");
      for (const id of ids) expect((await app.inject(`${urls[kind]}/${id}`)).statusCode).toBe(404);
    },
  );
});

describe("the guard on foreign keys", () => {
  // The schema names columns by their key; the database has them in snake case.
  const nameOf = (c: SQLiteColumn) =>
    `${getTableName(c.table)}.${c.name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}`;
  const covered = new Map<string, Set<string>>();
  for (const item of Object.values(ITEMS)) {
    const o = item as {
      uses: { via?: SQLiteColumn }[];
      goes?: SQLiteColumn[];
      clears?: SQLiteColumn[];
    };
    covered.set(
      getTableName(item.table),
      new Set(
        [
          ...o.uses.flatMap((u) => (u.via ? [u.via] : [])),
          ...(o.goes ?? []),
          ...(o.clears ?? []),
        ].map(nameOf),
      ),
    );
  }

  /** FKs to one of the 16 that `ITEMS` doesn't say anything about. */
  const uncovered = () => {
    const client = db.$client;
    const tables = client
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as { name: string }[];
    return tables.flatMap(({ name }) =>
      (
        client.prepare(`pragma foreign_key_list(\`${name}\`)`).all() as {
          table: string;
          from: string;
        }[]
      )
        .filter((fk) => covered.has(fk.table) && !covered.get(fk.table)?.has(`${name}.${fk.from}`))
        .map((fk) => `${name}.${fk.from} -> ${fk.table}`),
    );
  };

  it("every FK to one of the 16 is in the map", () => {
    expect(covered.size).toBe(16);
    expect(uncovered()).toEqual([]);
  });

  it("fails on a new one", () => {
    db.$client.exec("CREATE TABLE gadgets (printer_id text REFERENCES printers(id))");
    expect(uncovered()).toEqual(["gadgets.printer_id -> printers"]);
  });

  it("what the map says goes or clears, the FK does", () => {
    const fks = new Map<string, string>();
    for (const item of Object.values(ITEMS)) {
      const o = item as { goes?: SQLiteColumn[]; clears?: SQLiteColumn[] };
      for (const c of o.clears ?? []) fks.set(nameOf(c), "SET NULL");
      // Its FK restricts, so the item's `before` removes the entries.
      for (const c of o.goes ?? [])
        if (c !== schema.spoolWeightEntries.spoolId) fks.set(nameOf(c), "CASCADE");
    }
    expect(fks.size).toBeGreaterThan(0);
    for (const [column, action] of fks) {
      const [table, from] = column.split(".");
      const fk = (
        db.$client.prepare(`pragma foreign_key_list(\`${table}\`)`).all() as {
          from: string;
          on_delete: string;
        }[]
      ).find((f) => f.from === from);
      expect(fk?.on_delete, column).toBe(action);
    }
  });
});
