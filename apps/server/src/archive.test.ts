import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, schema } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateAlerts } from "./alerts/evaluate.ts";
import { buildApp } from "./app.ts";
import { autoSliceOn } from "./projects/autoSlice.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

const send = (method: "POST" | "PATCH" | "PUT", url: string, payload: object) =>
  app.inject({ method, url, payload });
const made = async (url: string, payload: object): Promise<{ id: string }> => {
  const res = await send("POST", url, payload);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
};
const archive = (url: string, archived = true) => send("PATCH", url, { archived });
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

/** One row of each of the 16, wired together the way real data is. */
async function seed() {
  const brand = await made("/api/brands", { name: "Acme" });
  const model = await made("/api/printer-models", { brandId: brand.id, model: "X1" });
  const machine = await made("/api/machine-profiles", { name: "M", printerModelId: model.id });
  const printProfile = await made("/api/print-profiles", { name: "Fine" });
  const printer = await made("/api/printers", {
    name: "P",
    modelId: model.id,
    state: "working",
    powerW: 100,
  });
  const accessory = await made("/api/accessories", { name: "AMS", type: "AMS", state: "working" });
  const type = db.insert(schema.maintenanceTypes).values({ name: "Oil" }).returning().get();
  const filamentBrand = await made("/api/filament-brands", { name: "Acme" });
  const material = await made("/api/filament-materials", { name: "PLA" });
  const profile = await made("/api/filament/profiles", {
    brandId: filamentBrand.id,
    materialId: material.id,
    densityGcm3: 1.24,
    name: "Basic",
    pricePerKg: 2000,
  });
  const spool = await made("/api/filament/spools", {
    profileId: profile.id,
    initialGrams: 1000,
    pricePaid: 2000,
  });
  const project = await made("/api/projects", { name: "Vase" });
  const client = await made("/api/clients", { name: "Ana", mobile: "911" });
  const quote = await made("/api/costs/quotes", quoteBody);
  const order = await made("/api/orders", { projectIds: [project.id], price: 500 });
  const print = await made("/api/prints", {
    printerId: printer.id,
    projectId: project.id,
    orderId: order.id,
    title: "Body",
    startedAt,
    durationSec: 3600,
    outcome: "success",
    usages: [{ spoolId: spool.id, grams: 50 }],
  });
  return {
    brand,
    model,
    machine,
    printProfile,
    printer,
    accessory,
    type,
    filamentBrand,
    material,
    profile,
    spool,
    project,
    client,
    quote,
    order,
    print,
  };
}
type Seed = Awaited<ReturnType<typeof seed>>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "archive-"));
  db = openDb(":memory:");
  app = await buildApp(db, false, dir);
});

afterEach(async () => {
  await app.close();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("archive and restore", () => {
  const entities: [string, string, (s: Seed) => string][] = [
    ["printer", "/api/printers", (s) => s.printer.id],
    ["accessory", "/api/accessories", (s) => s.accessory.id],
    ["maintenance type", "/api/maintenance/types", (s) => s.type.id],
    ["printer brand", "/api/brands", (s) => s.brand.id],
    ["printer model", "/api/printer-models", (s) => s.model.id],
    ["machine profile", "/api/machine-profiles", (s) => s.machine.id],
    ["print profile", "/api/print-profiles", (s) => s.printProfile.id],
    ["spool", "/api/filament/spools", (s) => s.spool.id],
    ["filament brand", "/api/filament-brands", (s) => s.filamentBrand.id],
    ["filament material", "/api/filament-materials", (s) => s.material.id],
    ["filament profile", "/api/filament/profiles", (s) => s.profile.id],
    ["project", "/api/projects", (s) => s.project.id],
    ["print", "/api/prints", (s) => s.print.id],
    ["order", "/api/orders", (s) => s.order.id],
    ["quote", "/api/costs/quotes", (s) => s.quote.id],
    ["client", "/api/clients", (s) => s.client.id],
  ];

  it.each(entities)(
    "%s: hidden from its list, found by the filter and by id",
    async (_, url, of) => {
      const id = of(await seed());
      const listed = async (q = "") =>
        ((await app.inject(`${url}${q}`)).json().items as { id: string }[]).some(
          (r) => r.id === id,
        );

      expect(await listed()).toBe(true);
      expect(await listed("?archived=true")).toBe(false);

      const res = await archive(`${url}/${id}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().archivedAt).toBeTruthy();
      expect(await listed()).toBe(false);
      expect(await listed("?archived=true")).toBe(true);
      expect(await listed("?archived=all")).toBe(true);
      expect((await app.inject(`${url}/${id}`)).json().archivedAt).toBeTruthy();

      const back = await archive(`${url}/${id}`, false);
      expect(back.statusCode, back.body).toBe(200);
      expect(back.json().archivedAt).toBeNull();
      expect(await listed()).toBe(true);
      expect(await listed("?archived=true")).toBe(false);
    },
  );

  it("archiving a project doesn't mark anything as user-edited", async () => {
    const { project } = await seed();
    const before = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
      .get();
    await archive(`/api/projects/${project.id}`);
    const after = db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get();
    expect(after?.editedFields).toEqual(before?.editedFields);
  });

  it("an installed accessory still blocks archiving its printer and itself", async () => {
    const s = await seed();
    await send("POST", `/api/accessories/${s.accessory.id}/installs`, {
      printerId: s.printer.id,
      installedAt: startedAt,
    });
    expect((await archive(`/api/printers/${s.printer.id}`)).json().error.code).toBe(
      "printer_has_accessories",
    );
    expect((await archive(`/api/accessories/${s.accessory.id}`)).json().error.code).toBe(
      "accessory_installed",
    );
  });
});

describe("what still counts", () => {
  const snapshot = async (s: Seed) => ({
    stats: (await app.inject("/api/stats")).json(),
    print: (await app.inject(`/api/prints/${s.print.id}`)).json(),
    order: (await app.inject(`/api/orders/${s.order.id}`)).json(),
    grams: (await app.inject(`/api/filament/spools/${s.spool.id}`)).json().remainingGrams,
    usage: (await app.inject("/api/printers?archived=all")).json().items[0].prints,
  });
  const noArchiveStamp = ({ print, order, ...rest }: Awaited<ReturnType<typeof snapshot>>) => {
    const { archivedAt: _p, updatedAt: _pu, ...p } = print;
    const { archivedAt: _o, updatedAt: _ou, ...o } = order;
    return { ...rest, print: p, order: o };
  };

  it.each([
    ["print", (s: Seed) => `/api/prints/${s.print.id}`],
    ["printer", (s: Seed) => `/api/printers/${s.printer.id}`],
    ["project", (s: Seed) => `/api/projects/${s.project.id}`],
    ["spool", (s: Seed) => `/api/filament/spools/${s.spool.id}`],
    ["filament profile", (s: Seed) => `/api/filament/profiles/${s.profile.id}`],
    ["order", (s: Seed) => `/api/orders/${s.order.id}`],
    ["client", (s: Seed) => `/api/clients/${s.client.id}`],
    ["printer model", (s: Seed) => `/api/printer-models/${s.model.id}`],
    ["printer brand", (s: Seed) => `/api/brands/${s.brand.id}`],
  ])("archiving a %s moves no stat, cost or spool weight", async (_, urlOf) => {
    const s = await seed();
    const before = await snapshot(s);
    expect(before.stats.totals.prints).toBe(1);
    expect(before.grams).toBe(950);

    expect((await archive(urlOf(s))).statusCode).toBe(200);

    expect(noArchiveStamp(await snapshot(s))).toEqual(noArchiveStamp(before));
  });

  it("archiving a print doesn't recalculate it from today's printer", async () => {
    const s = await seed();
    await send("PATCH", `/api/printers/${s.printer.id}`, { powerW: 900 });
    const before = (await app.inject(`/api/prints/${s.print.id}`)).json();
    expect(before.energyWh).toBe(100);

    await archive(`/api/prints/${s.print.id}`);

    const after = (await app.inject(`/api/prints/${s.print.id}`)).json();
    expect(after).toMatchObject({ energyWh: 100, durationSec: 3600, durationEstimated: false });
  });
});

describe("restoring an old preset version", () => {
  const source = "lib:system/a";
  const old = { sourcePreset: source, archivedAt: startedAt };

  const rows = (s: Seed) =>
    [
      [
        "/api/machine-profiles",
        (extra: object) =>
          db
            .insert(schema.machineProfiles)
            .values({ name: "M2", printerModelId: s.model.id, ...extra })
            .returning()
            .get().id,
      ],
      [
        "/api/print-profiles",
        (extra: object) =>
          db
            .insert(schema.printProfiles)
            .values({ name: "P2", ...extra })
            .returning()
            .get().id,
      ],
      [
        "/api/filament/profiles",
        (extra: object) =>
          db
            .insert(schema.filamentProfiles)
            .values({ name: "F2", materialId: s.material.id, densityGcm3: 1.24, ...extra })
            .returning()
            .get().id,
      ],
    ] as const;

  it("is a 409 while a current one exists, and works once none does", async () => {
    for (const [url, insert] of rows(await seed())) {
      const oldId = insert(old);
      const currentId = insert({ sourcePreset: source });

      const res = await archive(`${url}/${oldId}`, false);
      expect(res.statusCode, url).toBe(409);
      expect(res.json().error.code).toBe("preset_newer_exists");

      expect((await archive(`${url}/${currentId}`)).statusCode).toBe(200);
      const free = await archive(`${url}/${oldId}`, false);
      expect(free.statusCode, url).toBe(200);
      expect(free.json().archivedAt).toBeNull();
    }
  });
});

describe("references to archived rows", () => {
  it("printers: a new one is refused, the one it has stays", async () => {
    const s = await seed();
    const printer = `/api/printers/${s.printer.id}`;
    await send("PATCH", printer, { printProfileId: s.printProfile.id });
    await archive(`/api/printer-models/${s.model.id}`);
    await archive(`/api/print-profiles/${s.printProfile.id}`);

    const made = await send("POST", "/api/printers", {
      name: "Q",
      modelId: s.model.id,
      state: "working",
    });
    expect(made.json().error.code).toBe("invalid_model");

    const other = await send("POST", "/api/printers", {
      name: "Q",
      modelId: (
        await send("POST", "/api/printer-models", { brandId: s.brand.id, model: "X2" })
      ).json().id,
      state: "working",
      printProfileId: s.printProfile.id,
    });
    expect(other.json().error.code).toBe("invalid_reference");

    const edited = await send("PATCH", printer, {
      name: "P renamed",
      modelId: s.model.id,
      printProfileId: s.printProfile.id,
    });
    expect(edited.statusCode, edited.body).toBe(200);
  });

  it("quotes: a new project or client is refused, the ones it has stay", async () => {
    const s = await seed();
    const quote = await made("/api/costs/quotes", {
      ...quoteBody,
      projectId: s.project.id,
      clientId: s.client.id,
    });
    await archive(`/api/projects/${s.project.id}`);
    await archive(`/api/clients/${s.client.id}`);

    const code = async (extra: object) =>
      (await send("POST", "/api/costs/quotes", { ...quoteBody, ...extra })).json().error.code;
    expect(await code({ projectId: s.project.id })).toBe("invalid_project");
    expect(await code({ clientId: s.client.id })).toBe("invalid_client");

    const edited = await send("PATCH", `/api/costs/quotes/${quote.id}`, {
      name: "Renamed",
      projectId: s.project.id,
      clientId: s.client.id,
    });
    expect(edited.statusCode, edited.body).toBe(200);
  });

  it("orders: a new client, quote or project is refused, the ones it has stay", async () => {
    const s = await seed();
    const other = await made("/api/projects", { name: "Lamp" });
    const order = await made("/api/orders", {
      projectIds: [s.project.id, other.id],
      clientId: s.client.id,
      quoteId: s.quote.id,
      price: 1,
    });
    await archive(`/api/projects/${s.project.id}`);
    await archive(`/api/clients/${s.client.id}`);
    await archive(`/api/costs/quotes/${s.quote.id}`);

    const code = async (extra: object) =>
      (await send("POST", "/api/orders", { projectIds: [other.id], price: 1, ...extra })).json()
        .error.code;
    expect(await code({ clientId: s.client.id })).toBe("invalid_client");
    expect(await code({ quoteId: s.quote.id })).toBe("invalid_quote");
    expect(await code({ projectIds: [s.project.id] })).toBe("invalid_project");

    const edited = await send("PATCH", `/api/orders/${order.id}`, {
      projectIds: [s.project.id, other.id],
      clientId: s.client.id,
      quoteId: s.quote.id,
      price: 2,
    });
    expect(edited.statusCode, edited.body).toBe(200);
  });

  it("prints: a new printer, project, order or profile is refused, the ones it has stay", async () => {
    const s = await seed();
    await send("PATCH", `/api/prints/${s.print.id}`, { machineProfileId: s.machine.id });
    await archive(`/api/printers/${s.printer.id}`);
    await archive(`/api/projects/${s.project.id}`);
    await archive(`/api/orders/${s.order.id}`);
    await archive(`/api/machine-profiles/${s.machine.id}`);

    const printer = await made("/api/printers", {
      name: "Q",
      modelId: s.model.id,
      state: "working",
    });
    const project = await made("/api/projects", { name: "Lamp" });
    const base = { printerId: printer.id, title: "T", startedAt, outcome: "success" };
    const code = async (extra: object) =>
      (await send("POST", "/api/prints", { ...base, ...extra })).json().error.code;
    expect(await code({ printerId: s.printer.id })).toBe("invalid_printer");
    expect(await code({ projectId: s.project.id })).toBe("invalid_project");
    expect(await code({ projectId: project.id, orderId: s.order.id })).toBe("invalid_order");
    expect(await code({ machineProfileId: s.machine.id })).toBe("invalid_machine_profile");

    const edited = await send("PATCH", `/api/prints/${s.print.id}`, { notes: "kept" });
    expect(edited.statusCode, edited.body).toBe(200);
  });

  it("an accessory can't be installed on an archived printer", async () => {
    const s = await seed();
    await archive(`/api/printers/${s.printer.id}`);
    const res = await send("POST", `/api/accessories/${s.accessory.id}/installs`, {
      printerId: s.printer.id,
      installedAt: startedAt,
    });
    expect(res.json().error.code).toBe("invalid_printer");
  });
});

describe("alerts of an archived item", () => {
  const key = randomBytes(32);
  const log = { warn: vi.fn() };
  const open = (id: string, task: string, entityType = "test") =>
    db
      .insert(schema.alerts)
      .values({
        id,
        kind: "slice_failed",
        severity: "error",
        module: "projects",
        task,
        entityType,
        entityId: id,
      })
      .run();
  const stillOpen = () =>
    db
      .select()
      .from(schema.alerts)
      .all()
      .filter((a) => !a.resolvedAt)
      .map((a) => a.task);

  it("resolves the item's open alerts, and only those", async () => {
    const s = await seed();
    const cases: [string, string[]][] = [
      [`/api/filament/spools/${s.spool.id}`, [`spool:${s.spool.id}`]],
      [`/api/projects/${s.project.id}`, [`project:${s.project.id}`]],
      [
        `/api/printers/${s.printer.id}`,
        [`printer:${s.printer.id}`, `maintenance:${s.printer.id}:type`],
      ],
      [`/api/accessories/${s.accessory.id}`, [`maintenance:${s.accessory.id}:type`]],
      [`/api/maintenance/types/${s.type.id}`, [`maintenance:target:${s.type.id}`]],
    ];
    const other = `printer:${crypto.randomUUID()}`;
    open(crypto.randomUUID(), other);
    for (const [url, tasks] of cases) {
      for (const task of tasks) open(crypto.randomUUID(), task);
      expect((await archive(url)).statusCode, url).toBe(200);
      expect(stillOpen(), url).toEqual([other]);
    }
  });

  it("a restored item's alert comes back as new at the next evaluation", async () => {
    const { spool } = await seed();
    const url = `/api/filament/spools/${spool.id}`;
    await send("PATCH", url, { lowGrams: 2000 });
    const low = () =>
      db
        .select()
        .from(schema.alerts)
        .all()
        .filter((a) => a.kind === "spool_low");
    await evaluateAlerts(db, key, log);
    expect(low().filter((a) => !a.resolvedAt)).toHaveLength(1);

    await archive(url);
    expect(low().filter((a) => !a.resolvedAt)).toHaveLength(0);
    await evaluateAlerts(db, key, log);
    expect(low().filter((a) => !a.resolvedAt)).toHaveLength(0);

    await archive(url, false);
    await evaluateAlerts(db, key, log);
    expect(low()).toHaveLength(2);
    expect(low().filter((a) => !a.resolvedAt)).toHaveLength(1);
  });

  it("auto slice skips an archived project, even one set to slice", async () => {
    const { project } = await seed();
    const row = () =>
      db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, project.id))
        .get() as typeof schema.projects.$inferSelect;
    await send("PATCH", `/api/projects/${project.id}`, { autoSlice: true });
    expect(autoSliceOn(db, row())).toBe(true);
    await archive(`/api/projects/${project.id}`);
    expect(autoSliceOn(db, row())).toBe(false);
  });
});
