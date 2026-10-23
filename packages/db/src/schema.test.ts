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
  const materialId = db.insert(s.filamentMaterials).values({ name: "PLA" }).returning().get().id;
  profileId = db
    .insert(s.filamentProfiles)
    .values({ materialId, name: "N", densityGcm3: 1.24 })
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
    const rows = now.select().from(s.integrations).all();
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
      migrateAcross(58, (sqlite) => {
        const insert = sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
        fill((key, value) => insert.run(key, JSON.stringify(value)));
      })
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
