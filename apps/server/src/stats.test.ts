import type { PrintDetail, Stats } from "@3d-maker-suite/core";
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
    expect(bySpool.breakdowns.filament.map((f) => f.key)).toContain(spool?.profileId);

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
      expect(ms).toBeLessThan(500);
    }
    expect((await get(app)).totals.prints).toBe(10_000);
    expect((await get(app, `?tagId=${tag?.id}`)).totals.prints).toBeGreaterThan(900);
    console.info(`stats with 10k prints -> ${times.join(", ")}`);
  }, 60_000);
});
