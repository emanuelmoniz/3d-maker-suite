import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "./index.ts";
import * as s from "./schema.ts";
import { seed } from "./seed.ts";

let db: Db;
let brandId: string;
let modelId: string;
let printerId: string;
let spoolId: string;
let profileId: string;

const startedAt = "2026-01-01T10:00:00.000Z";
const total = (table: typeof s.printFilamentUsages | typeof s.taggings) =>
  db.select({ n: count() }).from(table).get()?.n;

beforeEach(() => {
  db = openDb(":memory:");
  brandId = db.insert(s.brands).values({ name: "B" }).returning().get().id;
  modelId = db.insert(s.printerModels).values({ brandId, model: "M" }).returning().get().id;
  printerId = db.insert(s.printers).values({ name: "P", modelId }).returning().get().id;
  profileId = db
    .insert(s.filamentProfiles)
    .values({ brand: "B", material: "PLA", name: "N", densityGcm3: 1.24 })
    .returning()
    .get().id;
  spoolId = db
    .insert(s.spools)
    .values({ profileId, initialGrams: 1000, remainingGrams: 1000 })
    .returning()
    .get().id;
});

const insertPrint = (values: Partial<typeof s.prints.$inferInsert> = {}) =>
  db
    .insert(s.prints)
    .values({ printerId, title: "T", startedAt, outcome: "success", ...values })
    .returning()
    .get();

describe("schema", () => {
  it("stores a multi-spool print", () => {
    const print = insertPrint({ energyWh: 120, energySource: "estimated" });
    db.insert(s.printFilamentUsages)
      .values([
        { printId: print.id, spoolId, profileId, grams: 12.5, slot: 0 },
        { printId: print.id, spoolId: null, profileId, grams: 3, slot: 1 },
      ])
      .run();
    expect(total(s.printFilamentUsages)).toBe(2);
  });

  it("rejects a failure reason on a successful print", () => {
    expect(() => insertPrint({ failureReason: "Spaghetti" })).toThrow(/CHECK/);
    expect(insertPrint({ outcome: "failed", failureReason: "Spaghetti" }).id).toBeTruthy();
  });

  it("requires energy and its source together", () => {
    expect(() => insertPrint({ energyWh: 100 })).toThrow(/CHECK/);
    expect(() => insertPrint({ energySource: "measured" })).toThrow(/CHECK/);
  });

  it("deleting a print removes its usages and taggings", () => {
    const print = insertPrint();
    db.insert(s.printFilamentUsages).values({ printId: print.id, spoolId, grams: 5 }).run();
    const tag = db.insert(s.tags).values({ name: "x", color: "#ffffff" }).returning().get();
    db.insert(s.taggings).values({ tagId: tag.id, entityType: "print", entityId: print.id }).run();

    db.delete(s.prints).where(eq(s.prints.id, print.id)).run();
    expect(total(s.printFilamentUsages)).toBe(0);
    expect(total(s.taggings)).toBe(0);
  });

  it("refuses to hard-delete a spool with history", () => {
    const print = insertPrint();
    db.insert(s.printFilamentUsages).values({ printId: print.id, spoolId, grams: 5 }).run();
    expect(() => db.delete(s.spools).where(eq(s.spools.id, spoolId)).run()).toThrow(/FOREIGN KEY/);
  });

  it("allows one unresolved alert per entity", () => {
    const alert = { kind: "spool_low" as const, entityType: "spool", entityId: spoolId };
    const first = db.insert(s.alerts).values(alert).returning().get();
    expect(() => db.insert(s.alerts).values(alert).run()).toThrow(/UNIQUE/);

    db.update(s.alerts).set({ resolvedAt: startedAt }).where(eq(s.alerts.id, first.id)).run();
    expect(() => db.insert(s.alerts).values(alert).run()).not.toThrow();
  });

  it("dedupes imported rows by (integrationId, externalId)", () => {
    const integrationId = db
      .insert(s.integrations)
      .values({ adapterId: "test", name: "Test" })
      .returning()
      .get().id;
    const imported = { origin: "integration" as const, integrationId, externalId: "job-1" };
    insertPrint(imported);
    expect(() => insertPrint(imported)).toThrow(/UNIQUE/);
  });

  it("tag names are unique ignoring case", () => {
    db.insert(s.tags).values({ name: "Gift", color: "#ffffff" }).run();
    expect(() => db.insert(s.tags).values({ name: "gift", color: "#ffffff" }).run()).toThrow(
      /UNIQUE/,
    );
  });
});

describe("printer catalog", () => {
  it("brand names and models per brand are unique ignoring case", () => {
    const brand = db.insert(s.brands).values({ name: "Acme" }).returning().get();
    expect(() => db.insert(s.brands).values({ name: "ACME" }).run()).toThrow(/UNIQUE/);
    db.insert(s.printerModels).values({ brandId: brand.id, model: "X1" }).run();
    expect(() =>
      db.insert(s.printerModels).values({ brandId: brand.id, model: "x1" }).run(),
    ).toThrow(/UNIQUE/);
  });

  it("refuses to delete a brand or model in use", () => {
    expect(() => db.delete(s.printerModels).where(eq(s.printerModels.id, modelId)).run()).toThrow(
      /FOREIGN KEY/,
    );
    expect(() => db.delete(s.brands).where(eq(s.brands.id, brandId)).run()).toThrow(/FOREIGN KEY/);
  });
});

/** Migrates up to `lastIdx`, lets `fill` add old-shape rows, then applies the rest. */
function migrateAcross(lastIdx: number, fill: (sqlite: Database.Database) => void) {
  const real = fileURLToPath(new URL("../migrations", import.meta.url));
  const before = mkdtempSync(join(tmpdir(), "mig-"));
  cpSync(real, before, { recursive: true });
  const journal = JSON.parse(readFileSync(join(before, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= lastIdx);
  writeFileSync(join(before, "meta/_journal.json"), JSON.stringify(journal));

  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const old = drizzle({ client: sqlite, casing: "snake_case" });
  migrate(old, { migrationsFolder: before });
  fill(sqlite);
  migrate(old, { migrationsFolder: real });
  rmSync(before, { recursive: true, force: true });
  return drizzle({ client: sqlite, schema: s, casing: "snake_case" });
}

describe("migration 0017", () => {
  it("moves free-text brand/model into the catalog", () => {
    const now = migrateAcross(16, (sqlite) => {
      const at = "2026-01-01T00:00:00.000Z";
      const printer = sqlite.prepare(
        "INSERT INTO printers (id, name, brand, model, power_w, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const rows: [string, string, string, number | null][] = [
        ["a", "Bambu Lab", "P1S", 120],
        ["b", "bambu lab ", "p1s", 150],
        ["c", "Bambu Lab", "X1C", null],
        ["d", "Prusa", "MK4", null],
        ["e", "", "", null],
      ];
      for (const [n, brand, model, w] of rows)
        printer.run(crypto.randomUUID(), n, brand, model, w, at, at);
      sqlite
        .prepare(
          "INSERT INTO maintenance_types (id, name, applies_to_models, created_at, updated_at) VALUES (?, 'T', ?, ?, ?)",
        )
        .run(crypto.randomUUID(), JSON.stringify(["p1s", "Nope"]), at, at);
    });
    const brands = now.select().from(s.brands).all();
    expect(brands.map((b) => b.name).sort()).toEqual(["Bambu Lab", "Prusa", "Unknown"]);
    const models = now.select().from(s.printerModels).all();
    expect(models.map((m) => m.model).sort()).toEqual(["MK4", "P1S", "Unknown", "X1C"]);
    const p1s = models.find((m) => m.model === "P1S");
    expect(p1s?.powerW).toBe(150);
    const printers = now.select().from(s.printers).all();
    expect(printers.every((p) => p.modelId)).toBe(true);
    expect(printers.filter((p) => p.modelId === p1s?.id).map((p) => p.name)).toEqual(["a", "b"]);
    expect(now.select().from(s.maintenanceTypes).get()?.appliesToModelIds).toEqual([p1s?.id]);
  });
});

describe("migration 0019", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const setting = (sqlite: Database.Database, key: string, value: unknown) =>
    sqlite
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(key, JSON.stringify(value));
  const cloud = (sqlite: Database.Database, id: string, createdAt: string) =>
    sqlite
      .prepare(
        "INSERT INTO integrations (id, adapter_id, name, config, created_at, updated_at) VALUES (?, 'bambu-cloud', ?, '{}', ?, ?)",
      )
      .run(id, id, createdAt, createdAt);
  const prefsLeft = (now: ReturnType<typeof migrateAcross>) =>
    now
      .select()
      .from(s.settings)
      .all()
      .map((r) => r.key);

  it("moves the slicer paths onto the oldest Bambu integration, all features on", () => {
    const now = migrateAcross(18, (sqlite) => {
      cloud(sqlite, "newer", "2026-02-01T00:00:00.000Z");
      cloud(sqlite, "older", at);
      setting(sqlite, "slicerPath", "C:/Bambu/bambu-studio.exe");
      setting(sqlite, "libraryPaths", { "bambu-studio": "D:/Studio" });
      setting(sqlite, "currency", "USD");
    });
    const rows = now.select().from(s.integrations).all();
    expect(rows).toHaveLength(2);
    const older = rows.find((r) => r.id === "older");
    expect(older).toMatchObject({
      slicerPath: "C:/Bambu/bambu-studio.exe",
      slicerConfigDir: "D:/Studio",
      disabledFeatures: [],
    });
    expect(rows.find((r) => r.id === "newer")?.slicerPath).toBeNull();
    expect(prefsLeft(now)).toEqual(["currency"]);
  });

  it("creates a slicer-only Bambu integration when Studio was used without the cloud", () => {
    const now = migrateAcross(18, (sqlite) => {
      setting(sqlite, "slicerPath", "");
      sqlite
        .prepare(
          "INSERT INTO filament_profiles (id, brand, material, name, density_gcm3, source_preset, created_at, updated_at) VALUES (?, 'B', 'PLA', 'N', 1.24, 'bambu-studio:x', ?, ?)",
        )
        .run(crypto.randomUUID(), at, at);
    });
    const [row] = now.select().from(s.integrations).all();
    expect(row).toMatchObject({
      adapterId: "bambu-cloud",
      enabled: true,
      slicerPath: null,
      slicerConfigDir: null,
      disabledFeatures: ["printers", "prints", "spools"],
    });
    expect(row?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(prefsLeft(now)).toEqual([]);
  });

  it("adds nothing when no slicer was set up", () => {
    const now = migrateAcross(18, (sqlite) => setting(sqlite, "libraryPaths", {}));
    expect(now.select().from(s.integrations).all()).toEqual([]);
    expect(prefsLeft(now)).toEqual([]);
  });
});

describe("seed", () => {
  it("fills an empty DB once", () => {
    const empty = openDb(":memory:");
    seed(empty);
    expect(empty.select({ n: count() }).from(s.prints).get()?.n).toBe(40);
    expect(() => seed(empty)).toThrow(/not empty/);
  });
});
