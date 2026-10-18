import { type CostContext, computeCost, type PrintDetail, type Stats } from "@3d-maker-suite/core";
import { openDb, schema, seed } from "@3d-maker-suite/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";

const NOW = new Date("2026-06-01T12:00:00Z");

async function setup(prints?: number) {
  const db = openDb(":memory:");
  seed(db, NOW, { prints });
  // Prices and rates that exercise every cost line.
  db.insert(schema.settings).values({ key: "energyCostPerKwh", value: 0.31 }).run();
  db.insert(schema.settings).values({ key: "printerLifetimeHours", value: 5000 }).run();
  return { db, app: await buildApp(db) };
}

const get = async (app: Awaited<ReturnType<typeof buildApp>>, query = "") =>
  (await app.inject(`/api/stats${query}`)).json() as Stats;

describe("stats", () => {
  it("matches the per-print costs shown in the prints list", async () => {
    const { app } = await setup();
    const list = (await app.inject("/api/prints?pageSize=100")).json().items as PrintDetail[];
    const stats = await get(app);
    const sum = (pick: (p: PrintDetail) => number) => list.reduce((n, p) => n + pick(p), 0);

    expect(stats.totals).toMatchObject({
      prints: list.length,
      successes: list.filter((p) => p.outcome === "success").length,
      material: sum((p) => p.cost.material),
      energy: sum((p) => p.cost.energy),
      wear: sum((p) => p.cost.wear),
      maintenance: sum((p) => p.cost.maintenance),
      total: sum((p) => p.cost.total),
    });
    expect(stats.totals.grams).toBeCloseTo(sum((p) => p.usages.reduce((n, u) => n + u.grams, 0)));
    expect(stats.series.reduce((n, r) => n + r.prints, 0)).toBe(list.length);
    expect(stats.breakdowns.printer.reduce((n, r) => n + r.total, 0)).toBe(stats.totals.total);
  });

  it("print costs, stats and the calculator agree on device and accessory rates", async () => {
    const { app, db } = await setup();
    const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
    const [x1, p1s] = db.select().from(schema.printers).orderBy(schema.printers.number).all();
    if (!x1 || !p1s) throw new Error("seed");
    db.insert(schema.settings)
      .values([
        { key: "includeMaintenanceCost", value: true },
        { key: "accessoryLifetimeHours", value: 300 },
        { key: "accessoryIncludeMaintenanceCost", value: true },
      ])
      .run();
    db.update(schema.printers)
      .set({ lifetimeHours: 8000, includeMaintenanceCost: false })
      .where(eq(schema.printers.id, x1.id))
      .run();
    const [ams, hotend, lid] = db
      .insert(schema.accessories)
      .values([
        { number: 1, name: "AMS", type: "AMS", purchasePrice: 34900 },
        { number: 2, name: "Hotend", type: "Hotend", purchasePrice: 2999, lifetimeHours: 500 },
        { number: 3, name: "Lid", type: "Lid", purchasePrice: 5000, countInCosts: false },
      ])
      .returning()
      .all();
    if (!ams || !hotend || !lid) throw new Error("insert");
    db.insert(schema.accessoryInstalls)
      .values([
        { accessoryId: ams.id, printerId: x1.id, installedAt: day(100), removedAt: day(70) },
        { accessoryId: ams.id, printerId: p1s.id, installedAt: day(60) },
        { accessoryId: hotend.id, printerId: p1s.id, installedAt: day(90) },
        { accessoryId: lid.id, printerId: p1s.id, installedAt: day(120) },
      ])
      .run();
    const typeId = db.select().from(schema.maintenanceTypes).get()?.id ?? "";
    const task = { typeId, printerRuntimeSecAt: 0, printerPrintsAt: 0 };
    db.insert(schema.maintenanceTasks)
      .values([
        { ...task, accessoryId: hotend.id, doneAt: day(10), cost: 1500 },
        { ...task, printerId: p1s.id, doneAt: day(5), cost: 4000 },
      ])
      .run();

    const list = (await app.inject("/api/prints?pageSize=100")).json().items as PrintDetail[];
    const sum = (pick: (p: PrintDetail) => number) => list.reduce((n, p) => n + pick(p), 0);
    expect((await get(app)).totals).toMatchObject({
      material: sum((p) => p.cost.material),
      energy: sum((p) => p.cost.energy),
      wear: sum((p) => p.cost.wear),
      maintenance: sum((p) => p.cost.maintenance),
      total: sum((p) => p.cost.total),
    });

    // The AMS counts on the X1C only inside its period there; the X1C's maintenance is off.
    const hours = (p?: PrintDetail) => (p?.durationSec ?? 0) / 3600;
    const x1Prints = list.filter((p) => p.printerId === x1.id);
    const inside = x1Prints.find((p) => p.startedAt >= day(100) && p.startedAt < day(70));
    const after = x1Prints.find((p) => p.startedAt >= day(70));
    expect(inside?.cost.wear).toBe(Math.round(hours(inside) * (34900 / 300 + 119900 / 8000)));
    expect(after?.cost).toMatchObject({
      wear: Math.round(hours(after) * (119900 / 8000)),
      maintenance: 0,
    });

    // The calculator uses what is on the P1S now (AMS + hotend, not the lid): its newest print,
    // made with the same set, costs the same.
    const ctx = (await app.inject("/api/costs/context")).json() as CostContext;
    const rate = ctx.printers.find((p) => p.id === p1s.id);
    const newest = list
      .filter((p) => p.printerId === p1s.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    if (!rate || !newest) throw new Error("missing");
    expect(rate.maintenancePerHour).toBeGreaterThan(0);
    expect(
      computeCost(
        { durationSec: newest.durationSec, energyWh: newest.energyWh, filaments: [] },
        { energyPerKwh: ctx.rates.energyPerKwh, ...rate },
      ),
    ).toMatchObject({ wear: newest.cost.wear, maintenance: newest.cost.maintenance });
  });

  it("handles filament without a price", async () => {
    const { app, db } = await setup();
    db.update(schema.filamentProfiles).set({ pricePerKg: null }).run();
    db.update(schema.spools).set({ pricePaid: null }).run();
    const stats = await get(app);
    expect(stats.totals).toMatchObject({ material: 0 });
    expect(stats.totals.unpricedGrams).toBeCloseTo(stats.totals.grams);
    expect(stats.breakdowns.filament.every((f) => f.material === 0)).toBe(true);
  });

  it("splits each print over its filaments by grams, one row per profile and colour", async () => {
    const { app } = await setup();
    const stats = await get(app);
    const rows = stats.breakdowns.filament;
    const sum = (pick: (r: (typeof rows)[number]) => number) =>
      rows.reduce((n, r) => n + pick(r), 0);
    // Seed: profile 0 comes in #1a1a1a (two spools) and #f5f5f5; profiles 1 and 2 in one colour each.
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.label)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/#1a1a1a$/),
        expect.stringMatching(/#f5f5f5$/),
      ]),
    );
    // Each row rounds on its own: at most a second / a cent per row away from the totals.
    expect(Math.abs(sum((r) => r.seconds) - stats.totals.seconds)).toBeLessThanOrEqual(rows.length);
    expect(Math.abs(sum((r) => r.total) - stats.totals.total)).toBeLessThanOrEqual(rows.length * 3);
    expect(sum((r) => r.grams)).toBeCloseTo(stats.totals.grams);
    expect(sum((r) => r.successes)).toBeGreaterThanOrEqual(stats.totals.successes);
  });

  it("counts only the filtered spool's share of its prints", async () => {
    const { app, db } = await setup();
    // Seed: spool 3 (#f5f5f5) shares every 4th print with spool 1.
    const spool = db.select().from(schema.spools).where(eq(schema.spools.number, 3)).get();
    const used = db
      .select()
      .from(schema.printFilamentUsages)
      .where(eq(schema.printFilamentUsages.spoolId, spool?.id ?? ""))
      .all();
    const whole = db
      .select()
      .from(schema.prints)
      .all()
      .filter((p) => used.some((u) => u.printId === p.id))
      .reduce((n, p) => n + (p.durationSec ?? 0), 0);
    const stats = await get(app, `?spoolId=${spool?.id}`);
    expect(stats.totals.prints).toBe(used.length);
    expect(stats.totals.grams).toBeCloseTo(used.reduce((n, u) => n + u.grams, 0));
    expect(stats.totals.seconds).toBeGreaterThan(0);
    expect(stats.totals.seconds).toBeLessThan(whole);
    expect(stats.breakdowns.filament).toHaveLength(1);
    expect(stats.breakdowns.filament[0]?.seconds).toBeCloseTo(stats.totals.seconds, -1);
  });

  it("filters by material, counting only that material's grams", async () => {
    const { app, db } = await setup();
    const profiles = db.select().from(schema.filamentProfiles).all();
    const material = profiles[0]?.materialId ?? "";
    const ofMaterial = new Set(profiles.filter((p) => p.materialId === material).map((p) => p.id));
    const used = db
      .select()
      .from(schema.printFilamentUsages)
      .all()
      .filter((u) => ofMaterial.has(u.profileId ?? ""));
    const stats = await get(app, `?materialId=${material}`);
    expect(stats.totals.prints).toBe(new Set(used.map((u) => u.printId)).size);
    expect(stats.totals.grams).toBeCloseTo(used.reduce((n, u) => n + u.grams, 0));
    expect(stats.totals.grams).toBeLessThan((await get(app)).totals.grams);
    expect(stats.breakdowns.filament.every((f) => ofMaterial.has(f.key?.split("|")[0] ?? ""))).toBe(
      true,
    );
  });

  it("fills empty buckets and reports the estimated part of the time", async () => {
    const { app, db } = await setup();
    const [first] = db.select().from(schema.prints).all();
    db.update(schema.prints)
      .set({ durationEstimated: true })
      .where(eq(schema.prints.id, first?.id ?? ""))
      .run();
    const stats = await get(app, "?bucket=day");
    const keys = stats.series.map((r) => r.key);
    const days = (Date.parse(keys.at(-1) ?? "") - Date.parse(keys[0] ?? "")) / 86_400_000;
    expect(keys).toHaveLength(days + 1);
    expect(stats.series.some((r) => r.prints === 0)).toBe(true);
    expect(stats.totals.estimatedSeconds).toBe(first?.durationSec);
  });

  it("filters by printer, outcome, spool and date, and exports the same view as CSV", async () => {
    const { app, db } = await setup();
    const [printer] = db.select().from(schema.printers).all();
    const spool = db.select().from(schema.spools).where(eq(schema.spools.location, "Shelf")).get();
    const q = `?printerId=${printer?.id}&outcome=failed,cancelled`;
    const filtered = await get(app, q);
    expect(filtered.totals.prints).toBeGreaterThan(0);
    expect(filtered.totals.successes).toBe(0);
    expect(filtered.breakdowns.printer).toHaveLength(1);

    const bySpool = await get(app, `?spoolId=${spool?.id}`);
    expect(bySpool.totals.prints).toBeLessThan((await get(app)).totals.prints);
    expect(bySpool.breakdowns.filament.map((f) => f.key)).toEqual([
      `${spool?.profileId}|${spool?.colorHex}`,
    ]);

    expect((await get(app, "?from=2030-01-01")).totals).toMatchObject({ prints: 0, total: 0 });

    const res = await app.inject(`/api/stats/csv${q}&bucket=month`);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.trim().split("\n");
    expect(lines[0]).toMatch(/^date,prints,/);
    expect(lines.at(-1)).toMatch(new RegExp(`^total,${filtered.totals.prints},`));
  });

  it("answers every view quickly with 10k prints", async () => {
    const { app, db } = await setup(10_000);
    const [printer] = db.select().from(schema.printers).all();
    const [tag] = db.select().from(schema.tags).all();
    const [spool] = db.select().from(schema.spools).all();
    const views = {
      all: "",
      "last 30 days": "?from=2026-05-02",
      printer: `?printerId=${printer?.id}`,
      "spool + month": `?spoolId=${spool?.id}&bucket=month`,
      "outcome + week": "?outcome=failed&bucket=week",
      tag: `?bucket=month&tagId=${tag?.id}`,
    };
    const times: string[] = [];
    for (const [name, query] of Object.entries(views)) {
      const t0 = performance.now();
      const stats = await get(app, query);
      const ms = performance.now() - t0;
      times.push(`${name}: ${ms.toFixed(0)} ms`);
      expect(stats.totals).toBeDefined();
      // ponytail: wall-clock budget for shared CI runners (local ~300 ms, CI saw ~725 ms); catches order-of-magnitude regressions only
      expect(ms).toBeLessThan(1500);
    }
    expect((await get(app)).totals.prints).toBe(10_000);
    expect((await get(app, `?tagId=${tag?.id}`)).totals.prints).toBeGreaterThan(900);
    console.info(`stats with 10k prints -> ${times.join(", ")}`);
  }, 60_000);
});
