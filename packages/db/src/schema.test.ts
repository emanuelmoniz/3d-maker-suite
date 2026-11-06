import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN_RIGHTS, BUILT_IN_ROLE_IDS } from "@3d-maker-suite/core";
import Database from "better-sqlite3";
import { count, eq, getTableColumns } from "drizzle-orm";
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

const startedAt = "2026-01-01T10:00:00.000Z";
const total = (table: typeof s.printFilamentUsages | typeof s.taggings) =>
  db.select({ n: count() }).from(table).get()?.n;

beforeEach(() => {
  db = openDb(":memory:");
  brandId = db.insert(s.brands).values({ name: "B" }).returning().get().id;
  modelId = db.insert(s.printerModels).values({ brandId, model: "M" }).returning().get().id;
  printerId = db.insert(s.printers).values({ name: "P", modelId }).returning().get().id;
  const materialId = db.insert(s.filamentMaterials).values({ name: "PLA" }).returning().get().id;
  spoolId = db
    .insert(s.spools)
    .values({ materialId, initialGrams: 1000, remainingGrams: 1000 })
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
        { printId: print.id, spoolId, grams: 12.5, slot: 0 },
        { printId: print.id, spoolId: null, material: "PLA", grams: 3, slot: 1 },
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
    const alert = {
      kind: "spool_low" as const,
      severity: "warning" as const,
      module: "filament" as const,
      task: `spool:${spoolId}`,
      entityType: "spool",
      entityId: spoolId,
    };
    const first = db.insert(s.alerts).values(alert).returning().get();
    expect(() => db.insert(s.alerts).values(alert).run()).toThrow(/UNIQUE/);

    db.update(s.alerts).set({ resolvedAt: startedAt }).where(eq(s.alerts.id, first.id)).run();
    expect(() => db.insert(s.alerts).values(alert).run()).not.toThrow();
  });

  it("dedupes imported rows by (integrationId, externalId)", () => {
    const integrationId = db
      .insert(s.integrations)
      .values({ adapterId: "test" })
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

/**
 * Migrates up to `lastIdx`, lets `fill` add old-shape rows, then applies the rest (up to
 * `untilIdx`, for a test whose rows a later migration changes again).
 */
function migrateAcross(
  lastIdx: number,
  fill: (sqlite: Database.Database) => void,
  untilIdx = Number.POSITIVE_INFINITY,
) {
  const real = fileURLToPath(new URL("../migrations", import.meta.url));
  const upTo = (idx: number) => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    cpSync(real, dir, { recursive: true });
    const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= idx);
    writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
    return dir;
  };
  const [before, after] = [upTo(lastIdx), upTo(untilIdx)];

  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const old = drizzle({ client: sqlite, casing: "snake_case" });
  migrate(old, { migrationsFolder: before });
  fill(sqlite);
  migrate(old, { migrationsFolder: after });
  for (const dir of [before, after]) rmSync(dir, { recursive: true, force: true });
  return drizzle({ client: sqlite, schema: s, casing: "snake_case" });
}

/** Sync policy columns as of 0025, for tests that stop before later ones. */
const policyColumns = {
  integrationId: s.syncPolicies.integrationId,
  type: s.syncPolicies.type,
  mode: s.syncPolicies.mode,
  frequency: s.syncPolicies.frequency,
  lastRunAt: s.syncPolicies.lastRunAt,
  cursor: s.syncPolicies.cursor,
  pending: s.syncPolicies.pending,
};

/** What `disabled_features` held before 0025: the types switched off for one integration. */
const offTypes = (now: ReturnType<typeof migrateAcross>, integrationId: string) =>
  now
    .select(policyColumns)
    .from(s.syncPolicies)
    .all()
    .filter((p) => p.integrationId === integrationId && p.mode === "off")
    .map((p) => p.type)
    .sort();

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
    // 0024 then moves them onto each row's Bambu Studio twin (same created_at).
    const twins = now
      .select()
      .from(s.integrations)
      .all()
      .filter((r) => r.adapterId === "bambu-studio");
    expect(twins).toHaveLength(2);
    expect(twins.find((r) => r.createdAt === at)).toMatchObject({
      slicerPath: "C:/Bambu/bambu-studio.exe",
      slicerConfigDir: "D:/Studio",
    });
    expect(twins.flatMap((r) => offTypes(now, r.id))).toEqual([]);
    expect(twins.find((r) => r.createdAt !== at)?.slicerPath).toBeNull();
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
    // Created as a Bambu row with the cloud parts off; 0024 makes it the Bambu Studio one.
    const rows = now.select().from(s.integrations).all();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      adapterId: "bambu-studio",
      enabled: true,
      slicerPath: null,
      slicerConfigDir: null,
    });
    expect(offTypes(now, row?.id ?? "")).toEqual([]);
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

describe("migration 0024", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const row = (
    sqlite: Database.Database,
    id: string,
    o: { adapter?: string; secrets?: string; off?: string[]; dir?: string; path?: string } = {},
  ) =>
    sqlite
      .prepare(
        `INSERT INTO integrations (id, adapter_id, config, secrets, disabled_features, slicer_config_dir, slicer_path, created_at, updated_at)
         VALUES (?, ?, '{"region":"china"}', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        o.adapter ?? "bambu-cloud",
        o.secrets ?? null,
        JSON.stringify(o.off ?? []),
        o.dir ?? null,
        o.path ?? null,
        at,
        at,
      );

  it("splits a Bambu row: the cloud half keeps id, token and log, the twin gets the folders", () => {
    const now = migrateAcross(
      23,
      (sqlite) => {
        row(sqlite, "acct", {
          secrets: "blob",
          off: ["prints", "openInSlicer"],
          dir: "D:/Studio",
          path: "C:/bs.exe",
        });
        row(sqlite, "other", { adapter: "mock", off: ["prints"], path: "C:/x.exe" });
        sqlite
          .prepare(
            "INSERT INTO sync_runs (id, integration_id, trigger, started_at, finished_at, status) VALUES ('run', 'acct', 'manual', ?, ?, 'ok')",
          )
          .run(at, at);
        sqlite
          .prepare("INSERT INTO settings (key, value) VALUES ('defaultSlicerId', ?)")
          .run(JSON.stringify("acct"));
      },
      63, // 0064 turns off data types into manual
    );
    // Only the columns that exist at 0064 (slicer_version came with 0071, catalog_fingerprint with 0096).
    const {
      slicerVersion: _,
      catalogFingerprint: __,
      ...columns
    } = getTableColumns(s.integrations);
    const rows = now.select(columns).from(s.integrations).all();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === "acct")).toMatchObject({
      adapterId: "bambu-cloud",
      secrets: "blob",
      config: { region: "china" },
      slicerConfigDir: null,
      slicerPath: null,
    });
    expect(offTypes(now, "acct")).toEqual(["prints"]);
    const studio = rows.find((r) => r.adapterId === "bambu-studio");
    expect(studio).toMatchObject({
      enabled: true,
      secrets: null,
      config: {},
      slicerConfigDir: "D:/Studio",
      slicerPath: "C:/bs.exe",
      createdAt: at,
    });
    expect(offTypes(now, studio?.id ?? "")).toEqual(["openInSlicer"]);
    expect(studio?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(now.select().from(s.syncRuns).get()?.integrationId).toBe("acct");
    expect(now.select().from(s.settings).get()?.value).toBe(studio?.id);
    expect(rows.find((r) => r.id === "other")).toMatchObject({
      adapterId: "mock",
      slicerPath: "C:/x.exe",
    });
    expect(offTypes(now, "other")).toEqual(["prints"]);
  });

  it("turns a slicer-only Bambu row into Bambu Studio in place", () => {
    const now = migrateAcross(23, (sqlite) =>
      row(sqlite, "studio", { off: ["printers", "prints", "spools"], path: "C:/bs.exe" }),
    );
    expect(now.select().from(s.integrations).all()).toMatchObject([
      {
        id: "studio",
        adapterId: "bambu-studio",
        config: {},
        slicerPath: "C:/bs.exe",
      },
    ]);
    expect(offTypes(now, "studio")).toEqual([]);
  });
});

describe("migration 0025", () => {
  it("carries the frequency, the switched-off features and the prints cursor into sync policies", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const synced = "2026-03-01T00:00:00.000Z";
    const printsAt = "2026-02-01T00:00:00.000Z";
    const now = migrateAcross(
      24,
      (sqlite) => {
        const row = sqlite.prepare(
          `INSERT INTO integrations (id, adapter_id, config, disabled_features, sync_frequency, last_sync_at, last_prints_sync_at, created_at, updated_at)
         VALUES (?, 'mock', '{}', ?, ?, ?, ?, ?, ?)`,
        );
        row.run("hourly", JSON.stringify(["prints", "spools"]), "1h", synced, printsAt, at, at);
        row.run("manual", "[]", "off", null, null, at, at);
      },
      63,
    );
    const of = (integrationId: string) =>
      now
        .select(policyColumns)
        .from(s.syncPolicies)
        .all()
        .filter((p) => p.integrationId === integrationId)
        .sort((a, b) => a.type.localeCompare(b.type));
    // The one frequency goes to both; a switched-off type stays off but keeps its cursor.
    expect(of("hourly")).toMatchObject([
      { type: "printers", mode: "auto", frequency: "1h", lastRunAt: synced, cursor: null },
      { type: "prints", mode: "off", frequency: "1h", lastRunAt: printsAt, cursor: printsAt },
      { type: "spools", mode: "off", frequency: "1d", lastRunAt: null, pending: 0 },
    ]);
    // "off" was manual-only: each type gets its default frequency for when it is switched to auto.
    expect(of("manual")).toMatchObject([
      { type: "printers", mode: "manual", frequency: "1d", lastRunAt: null },
      { type: "prints", mode: "manual", frequency: "1h", cursor: null },
    ]);
    // Deleting the integration takes its policies along.
    now.delete(s.integrations).run();
    expect(now.select(policyColumns).from(s.syncPolicies).all()).toEqual([]);
  });
});

describe("migration 0064", () => {
  it("turns off data types into manual, spools untracked; actions keep off", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const now = migrateAcross(63, (sqlite) => {
      sqlite
        .prepare(
          "INSERT INTO integrations (id, adapter_id, config, created_at, updated_at) VALUES ('i', 'mock', '{}', ?, ?)",
        )
        .run(at, at);
      const policy = sqlite.prepare(
        "INSERT INTO sync_policies (integration_id, type, mode, frequency) VALUES ('i', ?, ?, '1d')",
      );
      for (const [type, mode] of [
        ["printers", "auto"],
        ["prints", "off"],
        ["spools", "off"],
        ["slice", "off"],
      ])
        policy.run(type, mode);
    });
    const policies = now
      .select()
      .from(s.syncPolicies)
      .all()
      .map(({ type, mode, trackUsage }) => ({ type, mode, trackUsage }));
    expect(policies).toEqual([
      { type: "printers", mode: "auto", trackUsage: true },
      { type: "prints", mode: "manual", trackUsage: true },
      { type: "spools", mode: "manual", trackUsage: false },
      { type: "slice", mode: "off", trackUsage: true },
    ]);
  });
});

describe("migration 0065", () => {
  it("keeps every row in scope; printers and spools review changes, the rest keeps your edits", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const now = migrateAcross(64, (sqlite) => {
      sqlite
        .prepare(
          "INSERT INTO integrations (id, adapter_id, config, created_at, updated_at) VALUES ('i', 'mock', '{}', ?, ?)",
        )
        .run(at, at);
      const policy = sqlite.prepare(
        "INSERT INTO sync_policies (integration_id, type, mode, frequency) VALUES ('i', ?, 'manual', '1d')",
      );
      for (const type of ["printers", "spools", "brands"]) policy.run(type);
    });
    expect(
      now
        .select()
        .from(s.syncPolicies)
        .all()
        .map(({ type, scope, merge }) => ({ type, scope, merge })),
    ).toEqual([
      { type: "printers", scope: "all", merge: "review" },
      { type: "spools", scope: "all", merge: "review" },
      { type: "brands", scope: "all", merge: "keepEdits" },
    ]);
  });
});

describe("migration 0046", () => {
  it("adds print profiles; deleting one unsets printers and plates; a project takes its plates", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const now = migrateAcross(45, (sqlite) => {
      sqlite
        .prepare("INSERT INTO brands (id, name, created_at, updated_at) VALUES ('b', 'B', ?, ?)")
        .run(at, at);
      sqlite
        .prepare(
          "INSERT INTO printer_models (id, brand_id, model, created_at, updated_at) VALUES ('m', 'b', 'M', ?, ?)",
        )
        .run(at, at);
      sqlite
        .prepare(
          "INSERT INTO printers (id, name, model_id, created_at, updated_at) VALUES ('p', 'P', 'm', ?, ?)",
        )
        .run(at, at);
    });
    expect(now.select().from(s.printers).get()?.printProfileId).toBeNull();

    const profile = now
      .insert(s.printProfiles)
      .values({ name: "0.20mm Standard" })
      .returning()
      .get();
    now.update(s.printers).set({ printProfileId: profile.id }).run();
    const project = now.insert(s.projects).values({ name: "X" }).returning().get();
    const plate = { file: "a.3mf", fileSize: 1, fileMtimeMs: 1, fileSha256: "h" };
    now
      .insert(s.projectSlicePlates)
      .values({ ...plate, projectId: project.id, plate: 1, printProfileId: profile.id })
      .run();
    expect(() =>
      now
        .insert(s.projectSlicePlates)
        .values({ ...plate, projectId: project.id, plate: 1 })
        .run(),
    ).toThrow(/UNIQUE/);

    now.delete(s.printProfiles).run();
    expect(now.select().from(s.printers).get()?.printProfileId).toBeNull();
    expect(now.select().from(s.projectSlicePlates).get()?.printProfileId).toBeNull();
    now.delete(s.projects).run();
    expect(now.select().from(s.projectSlicePlates).all()).toEqual([]);
  });
});

describe("migration 0051", () => {
  it("numbers existing quotes 1..n by creation date", () => {
    const now = migrateAcross(50, (sqlite) => {
      const quote = sqlite.prepare(
        "INSERT INTO quotes (id, name, form, cost, quote, created_at, updated_at) VALUES (?, ?, '{}', '{}', '{}', ?, ?)",
      );
      for (const [name, day] of [
        ["b", "02"],
        ["c", "03"],
        ["a", "01"],
      ])
        quote.run(crypto.randomUUID(), name, `2026-01-${day}T00:00:00.000Z`, "x");
    });
    const rows = now.select().from(s.quotes).all();
    expect(rows.map((q) => [q.name, q.number]).sort()).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(rows.every((q) => q.clientId === null && q.notes === null)).toBe(true);
  });
});

describe("migration 0054", () => {
  it("gives every alert a severity, module and task; open ones keep their state", () => {
    const at = "2026-10-01T00:00:00.000Z";
    const sync = { integrationId: "i1", adapterId: "mock", type: "prints" };
    const old: [string, string, string, object, string | null][] = [
      ["maintenance_due", "maintenance", "p1:t1", { printer: "P", task: "T", overdue: 1 }, null],
      ["maintenance_due", "maintenance", "p1:t2", { printer: "P", task: "U", overdue: 0 }, null],
      ["spool_low", "spool", "s1", { name: "S", grams: 20 }, null],
      ["warranty_ending", "printer", "p1", { name: "P", days: 3 }, null],
      ["sync_pending", "integration", "i1:spools", { ...sync, type: "spools", count: 2 }, null],
      ["sync_success", "sync_run", "r1", { ...sync, created: 1, updated: 0 }, null],
      ["sync_error", "sync_run", "r2", { ...sync, code: "unreachable" }, null],
      ["sync_failed", "integration", "i1", {}, null],
      ["sync_failed", "integration", "i1", {}, at],
      ["print_failed", "print", "x", {}, null],
    ];
    const now = migrateAcross(53, (sqlite) => {
      const insert = sqlite.prepare(
        "INSERT INTO alerts (id, kind, entity_type, entity_id, context, created_at, read_at, notified_at, snoozed_until, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const [kind, type, entity, context, resolved] of old)
        insert.run(
          crypto.randomUUID(),
          kind,
          type,
          entity,
          JSON.stringify(context),
          at,
          at,
          at,
          at,
          resolved,
        );
    });
    const rows = now.select().from(s.alerts).all();
    const by = (entityId: string) =>
      rows
        .filter((r) => r.entityId === entityId)
        .map(({ kind, severity, module, task, context }) => ({
          kind,
          severity,
          module,
          task,
          context,
        }));

    expect(by("p1:t1")).toEqual([
      {
        kind: "maintenance_due",
        severity: "error",
        module: "maintenance",
        task: "maintenance:p1:t1",
        context: { printer: "P", task: "T" },
      },
    ]);
    expect(by("p1:t2")[0]).toMatchObject({ severity: "warning" });
    expect(by("s1")[0]).toMatchObject({
      severity: "warning",
      module: "filament",
      task: "spool:s1",
    });
    expect(by("p1")[0]).toMatchObject({
      severity: "warning",
      module: "printers",
      task: "printer:p1",
    });
    expect(by("i1:spools")[0]).toMatchObject({ severity: "warning", task: "sync:i1:spools" });
    expect(by("r1")[0]).toMatchObject({
      severity: "success",
      module: "integrations",
      task: "sync:i1:prints",
    });
    expect(by("r2")[0]).toMatchObject({ severity: "error", task: "sync:i1:prints" });
    // Old sync_failed: a resolved sync_error. print_failed was never raised: gone.
    expect(rows.filter((r) => r.entityId === "i1").map((r) => [r.kind, !!r.resolvedAt])).toEqual([
      ["sync_error", true],
      ["sync_error", true],
    ]);
    expect(rows.some((r) => r.entityId === "x")).toBe(false);
    // Open alerts keep their state, so nothing is sent again; none has a detail yet.
    const open = rows.filter((r) => !r.resolvedAt);
    expect(open).toHaveLength(7);
    expect(open.every((r) => r.readAt === at && r.notifiedAt === at && r.snoozedUntil === at)).toBe(
      true,
    );
    expect(rows.every((r) => r.detail === null)).toBe(true);
  });
});

describe("migration 0059", () => {
  const prefs = (fill: (set: (key: string, value: unknown) => void) => void) =>
    Object.fromEntries(
      migrateAcross(
        58,
        (sqlite) => {
          const insert = sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
          fill((key, value) => insert.run(key, JSON.stringify(value)));
        },
        // 0074 moves the roots into their own table.
        73,
      )
        .select()
        .from(s.settings)
        .all()
        .map((r) => [r.key, r.value]),
    );

  it("moves the depth and auto slice onto each root, files depth all", () => {
    expect(
      prefs((set) => {
        set("projectRoots", ["C:\\a", "/b"]);
        set("projectScanDepth", 2);
        set("autoSliceOffRoots", ["/b", "/gone"]);
      }),
    ).toEqual({
      projectRoots: [
        { path: "C:\\a", projectDepth: 2, filesDepth: null, autoSlice: true },
        { path: "/b", projectDepth: 2, filesDepth: null, autoSlice: false },
      ],
    });
  });

  it("uses depth 1 when none was saved", () => {
    expect(prefs((set) => set("projectRoots", ["/a"]))).toEqual({
      projectRoots: [{ path: "/a", projectDepth: 1, filesDepth: null, autoSlice: true }],
    });
    expect(prefs((set) => set("projectRoots", []))).toEqual({ projectRoots: [] });
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

describe("users", () => {
  const user = (email: string, roleId = BUILT_IN_ROLE_IDS.viewer) =>
    db.insert(s.users).values({ email, displayName: "U", passwordHash: "x", roleId }).run();

  it("keeps emails unique ignoring case", () => {
    user("me@example.com");
    expect(() => user("ME@example.com")).toThrow(/UNIQUE/);
  });

  it("takes only a stored role, and a role with users can't be deleted", () => {
    expect(() => user("a@b.c", crypto.randomUUID())).toThrow(/FOREIGN KEY/);
    user("a@b.c", BUILT_IN_ROLE_IDS.editor);
    expect(() => db.delete(s.roles).where(eq(s.roles.id, BUILT_IN_ROLE_IDS.editor)).run()).toThrow(
      /FOREIGN KEY/,
    );
  });

  it("seeds Admin, Editor and Viewer with core's rights", () => {
    const seeded = db.select().from(s.roles).all();
    expect(seeded.map((r) => [r.id, r.name, r.builtIn])).toEqual([
      [BUILT_IN_ROLE_IDS.admin, "Admin", "admin"],
      [BUILT_IN_ROLE_IDS.editor, "Editor", "editor"],
      [BUILT_IN_ROLE_IDS.viewer, "Viewer", "viewer"],
    ]);
    for (const r of seeded)
      expect({ permissions: r.permissions, projectRights: r.projectRights }).toEqual(
        BUILT_IN_RIGHTS[r.builtIn as "admin"],
      );
  });
});

describe("migrations 0086 and 0087", () => {
  it("moves roles and the old switches to role ids and overrides; nothing else is touched", () => {
    const now = migrateAcross(85, (sqlite) => {
      const user = (
        id: string,
        role: string,
        seeAll: number,
        editOthers: number,
        devices: number,
      ) =>
        sqlite
          .prepare(
            "insert into users (id, email, display_name, password_hash, role, projects_see_all, projects_edit_others, edit_other_devices, created_at, updated_at) values (?, ?, ?, 'x', ?, ?, ?, ?, 'x', 'x')",
          )
          .run(id, `${id}@x.io`, id, role, seeAll, editOthers, devices);
      user("admin", "admin", 1, 1, 1);
      user("adminNoDev", "admin", 0, 0, 0); // only the device switch counts for an admin
      user("ed", "editor", 1, 1, 0);
      user("edAll", "editor", 0, 0, 1);
      user("view", "viewer", 1, 1, 1); // editOthers and devices had no effect for a viewer
      user("viewOwn", "viewer", 0, 0, 0);
      const run = (q: string) => sqlite.prepare(q).run();
      run("insert into sessions (id, user_id, expires_at) values ('s', 'ed', 'x')");
      run("insert into user_settings (user_id, key, value) values ('ed', 'units', '\"metric\"')");
      run("insert into pairing_codes (id, user_id, expires_at) values ('c', 'ed', 'x')");
      run(
        "insert into devices (id, name, user_id, token_hash, created_at, updated_at) values ('dev', 'WS', 'ed', 't', 'x', 'x')",
      );
      run(
        "insert into hub_events (device_id, type, data, created_at) values ('dev', 'x', '{}', 'x')",
      );
      run(
        "insert into roots (id, name, location, path, position, created_at, updated_at) values ('r', 'r', 'hub', '/r', 0, 'x', 'x')",
      );
      run("insert into root_editors (root_id, user_id) values ('r', 'ed')");
      run(
        "insert into projects (id, name, owner_id, created_at, updated_at) values ('p', 'p', 'ed', 'x', 'x')",
      );
      run(
        "insert into alerts (id, kind, severity, module, task, entity_type, entity_id, created_at) values ('a', 'spool_low', 'warning', 'filament', 't', 'spool', 's1', 'x')",
      );
      run("insert into alert_states (alert_id, user_id, read_at) values ('a', 'ed', 'x')");
    });
    const users = Object.fromEntries(
      now
        .select()
        .from(s.users)
        .all()
        .map((u) => [u.id, [u.roleId, u.projectRights]]),
    );
    const { admin, editor, viewer } = BUILT_IN_ROLE_IDS;
    expect(users).toEqual({
      admin: [admin, {}],
      adminNoDev: [admin, { "projects.editOtherDevices": false }],
      ed: [editor, {}],
      edAll: [
        editor,
        {
          "projects.seeAll": false,
          "projects.editOthers": false,
          "projects.editOtherDevices": true,
        },
      ],
      view: [viewer, {}],
      viewOwn: [viewer, { "projects.seeAll": false }],
    });
    for (const t of [
      s.sessions,
      s.userSettings,
      s.pairingCodes,
      s.devices,
      s.hubEvents,
      s.rootEditors,
      s.alertStates,
    ])
      expect(now.select({ n: count() }).from(t).get()?.n).toBe(1);
    expect(now.select({ ownerId: s.projects.ownerId }).from(s.projects).get()).toEqual({
      ownerId: "ed",
    });
    expect(now.$client.pragma("foreign_key_check")).toEqual([]);
    // The email index came back.
    expect(() =>
      now
        .insert(s.users)
        .values({
          email: "ED@x.io",
          displayName: "x",
          passwordHash: "x",
          roleId: viewer,
        })
        .run(),
    ).toThrow(/UNIQUE/);
  });
});

describe("migration 0088", () => {
  const kinds = (on: { price?: boolean; openDate?: boolean }) => {
    const now = migrateAcross(87, (sqlite) => {
      const run = (q: string) => sqlite.prepare(q).run();
      if (on.price) run("insert into settings (key, value) values ('spoolNoPriceAlert', 'true')");
      run(
        `insert into settings (key, value) values ('spoolNoOpenDateAlert', '${on.openDate ? "true" : "false"}')`,
      );
      run(
        `insert into roles (id, name, permissions, project_rights, created_at, updated_at) values ('nf', 'No filament', '{"filament":"none"}', '{}', 'x', 'x')`,
      );
    });
    const keys = now
      .select({ key: s.settings.key })
      .from(s.settings)
      .all()
      .map((r) => r.key);
    expect(keys.filter((k) => k.startsWith("spoolNo"))).toEqual([]);
    return Object.fromEntries(
      now
        .select()
        .from(s.roles)
        .all()
        .map((r) => [r.builtIn ?? r.id, r.alertKinds]),
    );
  };

  it("the Admin role notifies every kind; the old spool switches become role defaults, then go", () => {
    const off = kinds({});
    expect(off.admin).toMatchObject({
      maintenance_due: "notify",
      hub_mass_delete: "notify",
      spool_no_price: "off",
      spool_no_open_date: "off",
    });
    // The 15 kinds of 0088, the two preset kinds 0090 adds and 0101's.
    expect(Object.keys(off.admin ?? {})).toHaveLength(18);
    expect([off.editor, off.viewer, off.nf]).toEqual([{}, {}, {}]);

    const on = kinds({ price: true, openDate: true });
    expect(on.admin).toMatchObject({ spool_no_price: "notify", spool_no_open_date: "notify" });
    const both = { spool_no_price: "app", spool_no_open_date: "app" };
    // A role that can't read filament gets nothing it couldn't see.
    expect([on.editor, on.viewer, on.nf]).toEqual([both, both, {}]);

    expect(kinds({ price: true }).viewer).toEqual({ spool_no_price: "app" });
  });
});

describe("migration 0104", () => {
  // ADR-0020: a spool takes its profile's brand, material and name; prices move to the material.
  const migrated = () =>
    migrateAcross(103, (sqlite) => {
      const run = (q: string, ...args: unknown[]) => sqlite.prepare(q).run(...args);
      const at = "2026-01-01T00:00:00.000Z";
      for (const [id, name] of [
        ["bambu", "Bambu Lab"],
        ["generic", "Generic"],
      ])
        run(
          "insert into filament_brands (id, name, created_at, updated_at) values (?, ?, ?, ?)",
          id,
          name,
          at,
          at,
        );
      for (const [id, name] of [
        ["pla", "PLA"],
        ["petg", "PETG"],
      ])
        run(
          "insert into filament_materials (id, name, created_at, updated_at) values (?, ?, ?, ?)",
          id,
          name,
          at,
          at,
        );
      const profile = (
        id: string,
        brand: string | null,
        material: string,
        name: string,
        price: number | null,
      ) =>
        run(
          "insert into filament_profiles (id, brand_id, material_id, name, density_gcm3, price_per_kg, created_at, updated_at) values (?, ?, ?, ?, 1.24, ?, ?, ?)",
          id,
          brand,
          material,
          name,
          price,
          at,
          at,
        );
      profile("basic", "bambu", "pla", "Bambu PLA Basic", 2000);
      profile("matte", "bambu", "pla", "Bambu Lab PLA Matte", 3000);
      profile("gpla", "generic", "pla", "Generic PLA", null);
      profile("own", null, "petg", "Silk Blue", null);
      const spool = (id: string, profileId: string, initial: number | null, paid: number | null) =>
        run(
          "insert into spools (id, profile_id, number, initial_grams, remaining_grams, price_paid, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
          id,
          profileId,
          id.length,
          initial,
          initial,
          paid,
          at,
          at,
        );
      spool("a", "basic", 500, null);
      spool("bb", "matte", 1000, 1500);
      spool("ccc", "gpla", 1000, null);
      spool("dddd", "own", null, null);
      spool("eeeee", "basic", null, null);
      run(
        "insert into printers (id, name, created_at, updated_at) values ('p', 'P', ?, ?)",
        at,
        at,
      );
      run(
        "insert into prints (id, printer_id, title, started_at, outcome, created_at, updated_at) values ('x', 'p', 'T', ?, 'success', ?, ?)",
        at,
        at,
        at,
      );
      run(
        "insert into print_filament_usages (id, print_id, spool_id, profile_id, grams) values ('u1', 'x', 'a', 'basic', 5)",
      );
      run(
        "insert into print_filament_usages (id, print_id, profile_id, grams, material) values ('u2', 'x', 'own', 3, 'PLA')",
      );
    });

  it("gives each spool its profile's brand, material and name, and keeps its cost", () => {
    const now = migrated();
    const spools = Object.fromEntries(
      now
        .select()
        .from(s.spools)
        .all()
        .map((r) => [r.id, [r.brandId, r.materialId, r.name, r.pricePaid]]),
    );
    expect(spools).toEqual({
      // The brand's first word leads: dropped. 2000/kg × 500 g.
      a: ["bambu", "pla", "PLA Basic", 1000],
      // The whole brand name leads: dropped. A price paid stays.
      bb: ["bambu", "pla", "PLA Matte", 1500],
      // Only the material is left: no name. No profile price: no price.
      ccc: ["generic", "pla", null, null],
      // No brand to drop.
      dddd: [null, "petg", "Silk Blue", null],
      // Weight unknown: nothing to work the price out from.
      eeeee: ["bambu", "pla", "PLA Basic", null],
    });
  });

  it("prices each material by its profiles' average and keeps usages' material", () => {
    const now = migrated();
    const prices = Object.fromEntries(
      now
        .select()
        .from(s.filamentMaterials)
        .all()
        .map((m) => [m.name, m.pricePerKg]),
    );
    expect(prices).toEqual({ PLA: 2500, PETG: null });
    const usages = Object.fromEntries(
      now
        .select()
        .from(s.printFilamentUsages)
        .all()
        .map((u) => [u.id, [u.spoolId, u.material]]),
    );
    // Without a spool, the profile's material.
    expect(usages).toEqual({ u1: ["a", null], u2: [null, "PETG"] });
    const columns = (table: string) =>
      (now.$client.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
    expect(columns("spools")).not.toContain("profile_id");
    expect(columns("print_filament_usages")).not.toContain("profile_id");
    for (const c of ["price_per_kg", "origin", "integration_id", "external_id"])
      expect(columns("filament_profiles")).not.toContain(c);
    expect(now.$client.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("migration 0103", () => {
  // ADR-0020: catalog from printers, filament and presets.manage; users on their effective values.
  const migrated = () =>
    migrateAcross(102, (sqlite) => {
      const run = (q: string, ...args: unknown[]) => sqlite.prepare(q).run(...args);
      const role = (id: string, permissions: object) =>
        run(
          "insert into roles (id, name, permissions, project_rights, created_at, updated_at) values (?, ?, ?, '{}', 'x', 'x')",
          id,
          id,
          JSON.stringify(permissions),
        );
      role("bothManage", { printers: "manage", filament: "manage", "presets.manage": false });
      role("oneManage", { printers: "manage", filament: "write", "presets.manage": false });
      role("presetsOnly", { printers: "read", filament: "none", "presets.manage": true });
      role("bothRead", { printers: "read", filament: "read", "presets.manage": false });
      role("empty", {});
      const user = (id: string, roleId: string, permissions: object) =>
        run(
          "insert into users (id, email, display_name, password_hash, role_id, permissions, created_at, updated_at) values (?, ?, ?, 'x', ?, ?, 'x', 'x')",
          id,
          `${id}@x.io`,
          id,
          roleId,
          JSON.stringify(permissions),
        );
      const { admin, editor, viewer } = BUILT_IN_ROLE_IDS;
      user("raised", viewer, { printers: "manage", filament: "manage", "hub.manage": true });
      user("noPresets", editor, { "presets.manage": false });
      user("same", editor, { printers: "read" });
      user("admin", admin, { "presets.manage": false, "projects.editOtherDevices": false });
    });

  it("gives each role catalog by the rules and drops presets.manage", () => {
    const roles = Object.fromEntries(
      migrated()
        .select()
        .from(s.roles)
        .all()
        .map((r) => [r.builtIn ?? r.id, r.permissions]),
    );
    expect(Object.fromEntries(Object.entries(roles).map(([k, p]) => [k, p.catalog]))).toEqual({
      admin: "manage",
      editor: "write",
      viewer: "read",
      // Gains preset housekeeping.
      bothManage: "manage",
      // Drops to read for catalog edits.
      oneManage: "read",
      presetsOnly: "write",
      bothRead: "read",
      empty: "none",
    });
    for (const p of Object.values(roles)) expect(p).not.toHaveProperty("presets.manage");
  });

  it("keeps a user's catalog override only where it differs from the role's", () => {
    const users = Object.fromEntries(
      migrated()
        .select()
        .from(s.users)
        .all()
        .map((u) => [u.id, u.permissions]),
    );
    expect(users).toEqual({
      raised: { printers: "manage", filament: "manage", "hub.manage": true, catalog: "manage" },
      noPresets: { catalog: "read" },
      same: { printers: "read" },
      admin: { "projects.editOtherDevices": false },
    });
  });
});

describe("migration 0101", () => {
  it("keeps presets, versions and alert states; owners start empty and go with their user", () => {
    const now = migrateAcross(100, (sqlite) => {
      const run = (q: string) => sqlite.prepare(q).run();
      run(
        `insert into users (id, email, display_name, password_hash, role_id, created_at, updated_at) values ('u', 'u@x.io', 'u', 'x', '${BUILT_IN_ROLE_IDS.admin}', 'x', 'x')`,
      );
      run(
        "insert into slicer_presets (id, library, kind, name, json, sha256, version, seq, saved_at) values ('p', 'bambu-studio', 'filament', 'P', '{}', 's', 2, 1, 'x')",
      );
      run(
        "insert into slicer_preset_versions (id, preset_id, version, json, sha256, saved_at) values ('v', 'p', 1, '{}', 's1', 'x')",
      );
      run(
        "insert into alerts (id, kind, severity, module, task, entity_type, entity_id, created_at) values ('a', 'preset_conflict', 'warning', 'hub', 't', 'preset', 'p', 'x')",
      );
      run(
        `insert into alert_states (alert_id, user_id, read_at, updated_at) values ('a', 'u', 'r', 'x')`,
      );
    });
    expect(now.select().from(s.slicerPresets).get()).toMatchObject({
      ownerUserId: null,
      heldBy: null,
      heldReason: null,
    });
    expect(now.select().from(s.slicerPresetVersions).all()).toHaveLength(1);
    expect(now.select().from(s.alertStates).all()).toEqual([
      expect.objectContaining({ alertId: "a", readAt: "r" }),
    ]);
    const admin = now
      .select()
      .from(s.roles)
      .all()
      .find((r) => r.builtIn === "admin");
    expect(admin?.alertKinds.preset_held).toBe("notify");

    // A deleted owner leaves the preset with none, so only catalog write deletes it.
    now.update(s.slicerPresets).set({ ownerUserId: "u" }).run();
    now.delete(s.users).run();
    expect(now.select().from(s.slicerPresets).get()?.ownerUserId).toBeNull();
  });
});

describe("migration 0090", () => {
  it("sets presets.manage on Admin and Editor only, and keeps alert states through the rebuild", () => {
    // Up to 0090: 0103 turns presets.manage into catalog.
    const now = migrateAcross(
      89,
      (sqlite) => {
        const run = (q: string) => sqlite.prepare(q).run();
        run(
          `insert into roles (id, name, permissions, project_rights, created_at, updated_at) values ('c', 'Custom', '{"hub.manage":true}', '{}', 'x', 'x')`,
        );
        run(
          `insert into users (id, email, display_name, password_hash, role_id, created_at, updated_at) values ('u', 'u@x.io', 'u', 'x', '${BUILT_IN_ROLE_IDS.admin}', 'x', 'x')`,
        );
        run(
          "insert into alerts (id, kind, severity, module, task, entity_type, entity_id, created_at) values ('a', 'hub_conflict', 'warning', 'hub', 't', 'file', 'f', 'x')",
        );
        run(
          `insert into alert_states (alert_id, user_id, read_at, updated_at, notified_at) values ('a', 'u', 'r', 'x', '{"email":"n"}')`,
        );
      },
      90,
    );
    const manage = Object.fromEntries(
      now
        .select()
        .from(s.roles)
        .all()
        .map((r) => [
          r.builtIn ?? r.id,
          (r.permissions as Record<string, unknown>)["presets.manage"],
        ]),
    );
    expect(manage).toEqual({ admin: true, editor: true, viewer: false, c: undefined });
    expect(now.select().from(s.alertStates).all()).toEqual([
      expect.objectContaining({ alertId: "a", readAt: "r", notifiedAt: { email: "n" } }),
    ]);
  });
});

describe("migration 0089", () => {
  const token = { v: 1, iv: "iv", tag: "tag", data: "data" };
  const migrated = (channels: { to?: string; topic?: string }) =>
    migrateAcross(88, (sqlite) => {
      const run = (q: string, ...args: unknown[]) => sqlite.prepare(q).run(...args);
      const user = (id: string, role: string, disabled: number, at: string) =>
        run(
          "insert into users (id, email, display_name, password_hash, role_id, disabled, created_at, updated_at) values (?, ?, ?, 'x', ?, ?, ?, ?)",
          id,
          `${id}@x.io`,
          id,
          BUILT_IN_ROLE_IDS[role as "admin"],
          disabled,
          at,
          at,
        );
      user("gone", "admin", 1, "2026-01-01");
      user("first", "admin", 0, "2026-02-01");
      user("later", "admin", 0, "2026-03-01");
      user("ed", "editor", 0, "2026-01-01");
      const setting = (key: string, value: object) =>
        run("insert into settings (key, value) values (?, ?)", key, JSON.stringify(value));
      if (channels.to !== undefined)
        setting("channel:email", {
          enabled: true,
          config: { host: "h", port: "25", from: "f", to: channels.to },
          secrets: null,
        });
      if (channels.topic !== undefined)
        setting("channel:ntfy", {
          enabled: false,
          config: { server: "https://ntfy.sh", topic: channels.topic },
          secrets: token,
        });
      const alert = (id: string, notifiedAt: string | null, resolvedAt: string | null) =>
        run(
          "insert into alerts (id, kind, severity, module, task, entity_type, entity_id, created_at, notified_at, resolved_at, read_at) values (?, 'spool_low', 'warning', 'filament', 't', 'spool', ?, 'x', ?, ?, 'r')",
          id,
          id,
          notifiedAt,
          resolvedAt,
        );
      alert("sent", "2026-04-01", null);
      alert("unsent", null, null);
      alert("closed", "2026-04-01", "2026-04-02");
    });
  const deliveries = (now: ReturnType<typeof migrated>) =>
    Object.fromEntries(
      now
        .select({ id: s.users.id, delivery: s.users.delivery })
        .from(s.users)
        .all()
        .map((u) => [u.id, u.delivery]),
    );

  it("gives today's recipient and topic to the oldest enabled admin; sent alerts count as sent to them", () => {
    const now = migrated({ to: "FIRST@x.io", topic: "shop" });
    expect(deliveries(now)).toEqual({
      gone: {},
      // The account email: no own address.
      first: { email: true, ntfyTopic: "shop", ntfyToken: token },
      later: {},
      ed: {},
    });
    expect(now.select().from(s.alertStates).all()).toEqual([
      {
        alertId: "sent",
        userId: "first",
        readAt: "r",
        snoozedUntil: null,
        dismissedAt: null,
        updatedAt: null,
        notifiedAt: { email: "2026-04-01", ntfy: "2026-04-01" },
      },
    ]);
  });

  it("keeps another address; no recipient or topic leaves delivery off", () => {
    expect(deliveries(migrated({ to: "shop@y.io" })).first).toEqual({
      email: true,
      emailTo: "shop@y.io",
    });
    expect(deliveries(migrated({ to: "", topic: "" })).first).toEqual({});
    expect(deliveries(migrated({})).first).toEqual({});
  });
});

describe("migration 0073", () => {
  it("rebuilds alerts for slicer_update and keeps each user's alert state", () => {
    const now = migrateAcross(72, (sqlite) => {
      const at = "2026-01-01T00:00:00.000Z";
      sqlite
        .prepare(
          "INSERT INTO users (id, email, display_name, password_hash, role, created_at, updated_at) VALUES ('u1', 'a@b.c', 'A', 'x', 'admin', ?, ?)",
        )
        .run(at, at);
      sqlite
        .prepare(
          "INSERT INTO alerts (id, kind, severity, module, task, entity_type, entity_id, created_at) VALUES ('a1', 'spool_low', 'warning', 'filament', 't', 'spool', 's1', ?)",
        )
        .run(at);
      sqlite
        .prepare("INSERT INTO alert_states (alert_id, user_id, read_at) VALUES ('a1', 'u1', ?)")
        .run(at);
    });
    expect(now.select().from(s.alertStates).all()).toMatchObject([{ alertId: "a1", userId: "u1" }]);
    now
      .insert(s.alerts)
      .values({
        kind: "slicer_update",
        severity: "success",
        module: "integrations",
        task: "t",
        entityType: "integration",
        entityId: "i1",
      })
      .run();
  });
});

describe("migration 0081", () => {
  it("rebuilds alerts for hub_mass_delete and keeps each user's alert state", () => {
    const now = migrateAcross(80, (sqlite) => {
      const at = "2026-01-01T00:00:00.000Z";
      sqlite
        .prepare(
          "INSERT INTO users (id, email, display_name, password_hash, role, created_at, updated_at) VALUES ('u1', 'a@b.c', 'A', 'x', 'admin', ?, ?)",
        )
        .run(at, at);
      sqlite
        .prepare(
          "INSERT INTO alerts (id, kind, severity, module, task, entity_type, entity_id, created_at) VALUES ('a1', 'spool_low', 'warning', 'filament', 't', 'spool', 's1', ?)",
        )
        .run(at);
      sqlite
        .prepare("INSERT INTO alert_states (alert_id, user_id, read_at) VALUES ('a1', 'u1', ?)")
        .run(at);
    });
    expect(now.select().from(s.alertStates).all()).toMatchObject([{ alertId: "a1", userId: "u1" }]);
    now
      .insert(s.alerts)
      .values({
        kind: "hub_mass_delete",
        severity: "warning",
        module: "hub",
        task: "t",
        entityType: "device",
        entityId: "d1",
      })
      .run();
  });
});

describe("migration 0080", () => {
  it("rebuilds alerts for hub_conflict and keeps each user's alert state", () => {
    const now = migrateAcross(79, (sqlite) => {
      const at = "2026-01-01T00:00:00.000Z";
      sqlite
        .prepare(
          "INSERT INTO users (id, email, display_name, password_hash, role, created_at, updated_at) VALUES ('u1', 'a@b.c', 'A', 'x', 'admin', ?, ?)",
        )
        .run(at, at);
      sqlite
        .prepare(
          "INSERT INTO alerts (id, kind, severity, module, task, entity_type, entity_id, created_at) VALUES ('a1', 'spool_low', 'warning', 'filament', 't', 'spool', 's1', ?)",
        )
        .run(at);
      sqlite
        .prepare("INSERT INTO alert_states (alert_id, user_id, read_at) VALUES ('a1', 'u1', ?)")
        .run(at);
    });
    expect(now.select().from(s.alertStates).all()).toMatchObject([{ alertId: "a1", userId: "u1" }]);
    now
      .insert(s.alerts)
      .values({
        kind: "hub_conflict",
        severity: "warning",
        module: "hub",
        task: "t",
        entityType: "hub_file",
        entityId: "f1",
      })
      .run();
  });
});

describe("migration 0079", () => {
  it("rebuilds alerts for connector_outdated and keeps each user's alert state", () => {
    const now = migrateAcross(78, (sqlite) => {
      const at = "2026-01-01T00:00:00.000Z";
      sqlite
        .prepare(
          "INSERT INTO users (id, email, display_name, password_hash, role, created_at, updated_at) VALUES ('u1', 'a@b.c', 'A', 'x', 'admin', ?, ?)",
        )
        .run(at, at);
      sqlite
        .prepare(
          "INSERT INTO alerts (id, kind, severity, module, task, entity_type, entity_id, created_at) VALUES ('a1', 'spool_low', 'warning', 'filament', 't', 'spool', 's1', ?)",
        )
        .run(at);
      sqlite
        .prepare("INSERT INTO alert_states (alert_id, user_id, read_at) VALUES ('a1', 'u1', ?)")
        .run(at);
    });
    expect(now.select().from(s.alertStates).all()).toMatchObject([{ alertId: "a1", userId: "u1" }]);
    now
      .insert(s.alerts)
      .values({
        kind: "connector_outdated",
        severity: "warning",
        module: "hub",
        task: "t",
        entityType: "device",
        entityId: "d1",
      })
      .run();
  });
});

describe("migration 0074", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const migrated = (
    roots: {
      path: string;
      projectDepth?: number;
      filesDepth?: number | null;
      autoSlice?: boolean;
    }[],
    projects: { id: string; folder?: string; unlinked?: string; file?: string }[],
  ) =>
    migrateAcross(73, (sqlite) => {
      sqlite
        .prepare("INSERT INTO settings (key, value) VALUES ('projectRoots', ?)")
        .run(JSON.stringify(roots));
      const insert = sqlite.prepare(
        "INSERT INTO projects (id, number, name, folder_path, unlinked_folder, file_path, created_at, updated_at) VALUES (?, ?, 'P', ?, ?, ?, ?, ?)",
      );
      for (const [i, p] of projects.entries())
        insert.run(p.id, i + 1, p.folder ?? null, p.unlinked ?? null, p.file ?? null, at, at);
      if (!projects[0]) return;
      // Rows that point at a project and would go with it if `projects` were rebuilt.
      sqlite
        .prepare(
          "INSERT INTO project_slice_plates (id, project_id, file, plate, file_size, file_mtime_ms, file_sha256, created_at, updated_at) VALUES ('pl', ?, 'a.3mf', 1, 1, 1, 'x', ?, ?)",
        )
        .run(projects[0]?.id, at, at);
      sqlite
        .prepare(
          "INSERT INTO collections (id, name, created_at, updated_at) VALUES ('c', 'C', ?, ?)",
        )
        .run(at, at);
      sqlite
        .prepare(
          "INSERT INTO collection_projects (collection_id, project_id, position) VALUES ('c', ?, 0)",
        )
        .run(projects[0]?.id);
    });

  it("moves the roots into a table, in order, named after their last folder", () => {
    const now = migrated(
      [
        { path: "C:\\Models\\\\", projectDepth: 2, filesDepth: 1, autoSlice: false },
        { path: "/srv/prints", projectDepth: 1, filesDepth: null, autoSlice: true },
        { path: "C:\\\\" },
      ],
      [],
    );
    expect(now.select().from(s.roots).orderBy(s.roots.position).all()).toMatchObject([
      {
        name: "Models",
        location: "hub",
        path: "C:\\Models\\\\",
        projectDepth: 2,
        filesDepth: 1,
        autoSlice: false,
        position: 0,
      },
      {
        name: "prints",
        location: "hub",
        path: "/srv/prints",
        projectDepth: 1,
        filesDepth: null,
        autoSlice: true,
        position: 1,
      },
      { name: "C:", path: "C:\\\\", projectDepth: 1, autoSlice: true, position: 2 },
    ]);
    expect(now.select().from(s.roots).all()[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(now.select().from(s.settings).all()).toEqual([]);
  });

  it("points each project at the deepest root it is below, with relative paths", () => {
    const now = migrated(
      [{ path: "C:\\3D\\projects" }, { path: "C:\\3D\\projects\\test4" }, { path: "/srv/a/" }],
      [
        {
          id: "outer",
          folder: "C:\\3D\\projects\\001_x",
          file: "C:\\3D\\projects\\001_x\\m\\a.3mf",
        },
        { id: "nested", folder: "C:\\3D\\projects\\test4\\002_y" },
        { id: "root4", folder: "C:\\3D\\projects\\test4" },
        { id: "case", folder: "c:\\3d\\Projects\\003_z" },
        { id: "posix", folder: "/srv/a/sub/004_w", file: "/srv/a/sub/004_w/b.stl" },
        { id: "gone", folder: "D:\\old\\005_v", file: "D:\\old\\005_v\\c.3mf" },
        { id: "prefix", folder: "C:\\3D\\projects2\\006_u" },
        { id: "kept", unlinked: "C:\\3D\\projects\\007_t" },
        { id: "keptGone", unlinked: "E:\\x\\008_s" },
        { id: "none" },
      ],
    );
    const roots = Object.fromEntries(
      now
        .select()
        .from(s.roots)
        .all()
        .map((r) => [r.name, r.id]),
    );
    const rows = Object.fromEntries(
      now
        .select({
          id: s.projects.id,
          rootId: s.projects.rootId,
          folder: s.projects.folder,
          unlinkedRootId: s.projects.unlinkedRootId,
          unlinkedFolder: s.projects.unlinkedFolder,
          filePath: s.projects.filePath,
        })
        .from(s.projects)
        .all()
        .map(({ id, ...r }) => [id, r]),
    );
    const linked = (
      root: string | null,
      folder: string | null,
      filePath: string | null = null,
    ) => ({
      rootId: root && roots[root],
      folder,
      unlinkedRootId: null,
      unlinkedFolder: null,
      filePath,
    });
    expect(rows).toEqual({
      outer: linked("projects", "001_x", "m/a.3mf"),
      nested: linked("test4", "002_y"),
      root4: linked("projects", "test4"),
      case: linked("projects", "003_z"),
      posix: linked("a", "sub/004_w", "b.stl"),
      // In no root: kept, unlinked.
      gone: linked(null, null, "c.3mf"),
      prefix: linked(null, null),
      kept: { ...linked(null, null), unlinkedRootId: roots.projects, unlinkedFolder: "007_t" },
      keptGone: linked(null, null),
      none: linked(null, null),
    });
    // Nothing that points at a project went with the column change.
    expect(now.select().from(s.projectSlicePlates).all()).toHaveLength(1);
    expect(now.select().from(s.collectionProjects).all()).toHaveLength(1);
  });
});

describe("migration 0078", () => {
  it("gives projects their device's user or the oldest enabled admin, and admins the device right", () => {
    const now = migrateAcross(
      77,
      (sqlite) => {
        const user = (id: string, role: string, disabled: number, at: string) =>
          sqlite
            .prepare(
              "insert into users (id, email, display_name, password_hash, role, disabled, created_at, updated_at) values (?, ?, ?, 'x', ?, ?, ?, ?)",
            )
            .run(id, `${id}@x.io`, id, role, disabled, at, at);
        user("gone", "admin", 1, "2026-01-01");
        user("first", "admin", 0, "2026-02-01");
        user("later", "admin", 0, "2026-03-01");
        user("ed", "editor", 0, "2026-01-01");
        sqlite
          .prepare(
            "insert into devices (id, name, user_id, token_hash, created_at, updated_at) values ('dev', 'WS', 'ed', 't', 'x', 'x')",
          )
          .run();
        const root = (id: string, location: string) =>
          sqlite
            .prepare(
              "insert into roots (id, name, location, path, position, created_at, updated_at) values (?, ?, ?, ?, 0, 'x', 'x')",
            )
            .run(id, id, location, `/${id}`);
        root("hub", "hub");
        root("ws", "dev");
        root("lost", "6f1c3f5e-7d4c-4c1e-9b1a-1a2b3c4d5e6f");
        const project = (id: string, rootId: string | null) =>
          sqlite
            .prepare(
              "insert into projects (id, name, root_id, folder, created_at, updated_at) values (?, ?, ?, ?, 'x', 'x')",
            )
            .run(id, id, rootId, rootId && id);
        project("onHub", "hub");
        project("onWs", "ws");
        project("onLost", "lost");
        project("none", null);
      },
      85,
    );
    const owners = Object.fromEntries(
      now
        .select({ id: s.projects.id, ownerId: s.projects.ownerId })
        .from(s.projects)
        .all()
        .map((p) => [p.id, p.ownerId]),
    );
    expect(owners).toEqual({ onHub: "first", onWs: "ed", onLost: "first", none: "first" });
    const rights = now.$client
      .prepare('select id, edit_other_devices "dev", projects_see_all "all" from users')
      .all();
    expect(rights).toEqual(
      expect.arrayContaining([
        { id: "first", dev: 1, all: 1 },
        { id: "ed", dev: 0, all: 1 },
      ]),
    );
    expect(now.select({ editBy: s.roots.editBy }).from(s.roots).all()).toEqual([
      { editBy: "roles" },
      { editBy: "roles" },
      { editBy: "roles" },
    ]);
  });

  it("leaves projects without an owner when no users exist", () => {
    const now = migrateAcross(77, (sqlite) => {
      sqlite
        .prepare(
          "insert into projects (id, name, created_at, updated_at) values ('p', 'p', 'x', 'x')",
        )
        .run();
    });
    expect(now.select({ ownerId: s.projects.ownerId }).from(s.projects).all()).toEqual([
      { ownerId: null },
    ]);
  });
});

describe("upgrading from 5.1.0", () => {
  it("keeps the rows; nothing starts archived; a pairing code has no device", () => {
    const now = migrateAcross(92, (sqlite) => {
      sqlite.exec(`
        insert into brands (id, name, created_at, updated_at) values ('b', 'Acme', 'x', 'x');
        insert into clients (id, name, mobile, created_at, updated_at) values ('c', 'Ana', '91', 'x', 'x');
      `);
    });
    expect(
      now.select({ name: s.brands.name, at: s.brands.archivedAt }).from(s.brands).all(),
    ).toEqual([{ name: "Acme", at: null }]);
    expect(now.select({ at: s.clients.archivedAt }).from(s.clients).all()).toEqual([{ at: null }]);
    expect(now.select().from(s.deletedSources).all()).toEqual([]);
    expect(now.$client.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("migration 0106", () => {
  it("archives hand-made profiles; their printers and plates slice from the file", () => {
    const now = migrateAcross(105, (sqlite) => {
      sqlite.exec(`
        insert into brands (id, name, created_at, updated_at) values ('b', 'Acme', 'x', 'x');
        insert into printer_models (id, brand_id, model, created_at, updated_at) values ('m', 'b', 'X1', 'x', 'x');
        insert into print_profiles (id, name, source_preset, created_at, updated_at) values
          ('hand', 'Mine', null, 'x', 'x'), ('file', 'Fine', 'bambu-studio:system/Fine', 'x', 'x');
        insert into machine_profiles (id, name, printer_model_id, nozzle_diameter_mm, created_at, updated_at)
          values ('mHand', 'M', 'm', 0.4, 'x', 'x');
        insert into filament_materials (id, name, created_at, updated_at) values ('pla', 'PLA', 'x', 'x');
        insert into filament_profiles (id, material_id, name, density_gcm3, source_preset, created_at, updated_at) values
          ('fHand', 'pla', 'Cheap', 1.24, null, 'x', 'x'), ('fFile', 'pla', 'Basic', 1.24, 'bambu-studio:system/Basic', 'x', 'x');
        insert into printers (id, number, name, model_id, state, print_profile_id, created_at, updated_at)
          values ('p1', 1, 'A', 'm', 'working', 'hand', 'x', 'x'), ('p2', 2, 'B', 'm', 'working', 'file', 'x', 'x');
        insert into projects (id, name, created_at, updated_at) values ('pr', 'Vase', 'x', 'x');
        insert into project_slice_plates (id, project_id, file, plate, file_size, file_mtime_ms, file_sha256, print_profile_id, filaments, sliced_at, created_at, updated_at)
          values ('pl', 'pr', 'a.3mf', 1, 1, 1, 'x', 'hand', '["fFile",null,"fHand"]', '2026-01-01', 'x', 'x');
      `);
    });
    const archived = (
      t: typeof s.printProfiles | typeof s.machineProfiles | typeof s.filamentProfiles,
    ) =>
      Object.fromEntries(
        now
          .select({ id: t.id, at: t.archivedAt })
          .from(t)
          .all()
          .map((r) => [r.id, r.at !== null]),
      );
    expect(archived(s.printProfiles)).toEqual({ hand: true, file: false });
    expect(archived(s.machineProfiles)).toEqual({ mHand: true });
    expect(archived(s.filamentProfiles)).toEqual({ fHand: true, fFile: false });
    expect(
      now.select({ id: s.printers.id, p: s.printers.printProfileId }).from(s.printers).all(),
    ).toEqual([
      { id: "p1", p: null },
      { id: "p2", p: "file" },
    ]);
    // The slice stays: a hand-made profile never sliced.
    expect(
      now
        .select({
          p: s.projectSlicePlates.printProfileId,
          f: s.projectSlicePlates.filaments,
          at: s.projectSlicePlates.slicedAt,
        })
        .from(s.projectSlicePlates)
        .all(),
    ).toEqual([{ p: null, f: ["fFile", null, null], at: "2026-01-01" }]);
    expect(now.$client.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("migration 0107", () => {
  it("gives each printer its machine profile by model and nozzle, a system preset first", () => {
    const now = migrateAcross(106, (sqlite) => {
      sqlite.exec(`
        insert into brands (id, name, created_at, updated_at) values ('b', 'Acme', 'x', 'x');
        insert into printer_models (id, brand_id, model, created_at, updated_at) values
          ('x1', 'b', 'X1', 'x', 'x'), ('p1', 'b', 'P1', 'x', 'x');
        insert into machine_profiles (id, name, printer_model_id, nozzle_diameter_mm, source_preset, archived_at, created_at, updated_at) values
          ('aUser', 'A mine', 'x1', 0.4, 'bambu-studio:user/A mine', null, 'x', 'x'),
          ('sys', 'Acme X1 0.4 nozzle', 'x1', 0.4, 'bambu-studio:system/Acme X1 0.4 nozzle', null, 'x', 'x'),
          ('old', 'Acme X1 0.4 nozzle', 'x1', 0.4, 'bambu-studio:system/Acme X1 0.4 nozzle', '2026-01-01', 'x', 'x'),
          ('six', 'Acme X1 0.6 nozzle', 'x1', 0.6, 'bambu-studio:system/Acme X1 0.6 nozzle', null, 'x', 'x');
        insert into printers (id, number, name, model_id, nozzle_diameter_mm, state, created_at, updated_at) values
          ('a', 1, 'A', 'x1', 0.4, 'working', 'x', 'x'), ('b', 2, 'B', 'x1', 0.6, 'working', 'x', 'x'),
          ('c', 3, 'C', 'x1', 0.8, 'working', 'x', 'x'), ('d', 4, 'D', 'p1', 0.4, 'working', 'x', 'x');
      `);
    });
    expect(
      now
        .select({ id: s.printers.id, m: s.printers.machineProfileId })
        .from(s.printers)
        .orderBy(s.printers.number)
        .all(),
    ).toEqual([
      { id: "a", m: "sys" },
      { id: "b", m: "six" },
      { id: "c", m: null },
      { id: "d", m: null },
    ]);
    // The printer's machine profile clears with it; the printer stays.
    now.delete(s.machineProfiles).where(eq(s.machineProfiles.id, "six")).run();
    expect(
      now.select().from(s.printers).where(eq(s.printers.id, "b")).get()?.machineProfileId,
    ).toBeNull();
  });
});
