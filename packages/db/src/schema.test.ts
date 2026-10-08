import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "./index.ts";
import * as s from "./schema.ts";
import { seed } from "./seed.ts";

let db: Db;
let printerId: string;
let spoolId: string;
let profileId: string;

const startedAt = "2026-01-01T10:00:00.000Z";
const total = (table: typeof s.printFilamentUsages | typeof s.taggings) =>
  db.select({ n: count() }).from(table).get()?.n;

beforeEach(() => {
  db = openDb(":memory:");
  printerId = db
    .insert(s.printers)
    .values({ name: "P", brand: "B", model: "M" })
    .returning()
    .get().id;
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

describe("seed", () => {
  it("fills an empty DB once", () => {
    const empty = openDb(":memory:");
    seed(empty);
    expect(empty.select({ n: count() }).from(s.prints).get()?.n).toBe(40);
    expect(() => seed(empty)).toThrow(/not empty/);
  });
});
